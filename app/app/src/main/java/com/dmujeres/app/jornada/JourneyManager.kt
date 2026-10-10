package com.dmujeres.app.jornada

import android.content.Context
import android.util.Log
import androidx.preference.PreferenceManager
import org.json.JSONObject
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.sesion.JourneyOutbox
import com.dmujeres.app.datos.Prefs
import java.net.HttpURLConnection
import java.net.URL

/**
 * Jornada guardada y puesta al día con el servidor.
 *
 * Se guarda en `meta` además de en las preferencias: las preferencias las lee
 * la pantalla, pero al reiniciarse el registro manda `meta`, que está en la
 * misma base que la cola de puntos.
 *
 * Al arrancar se pregunta al servidor (`GET /api/mobile/v1/journey`) si hay
 * jornada abierta. Si el servidor no tiene esa ruta (404), se sigue con lo
 * guardado en el teléfono.
 */
class JourneyManager(context: Context) {

    private val appContext = context.applicationContext

    data class LocalJourney(val journeyId: String, val startedAtMs: Long, val open: Boolean)

    data class RemoteJourney(val open: Boolean, val journeyId: String, val startedAtMs: Long)

    enum class ReconcileOutcome { ADOPTED_REMOTE, KEPT_LOCAL, IN_SYNC, FALLBACK_LOCAL }

    /** Jornada local: meta manda; si está vacía se hereda de prefs (migración). */
    fun local(): LocalJourney? {
        val db = runCatching { DatabaseHelper(appContext) }.getOrNull()
        val metaId = db?.getMeta(DatabaseHelper.KEY_JOURNEY_ID)
        val metaAt = db?.getMeta(DatabaseHelper.KEY_JOURNEY_STARTED_AT)?.toLongOrNull() ?: 0L
        if (!metaId.isNullOrBlank()) {
            // Sin marca clara de apertura no se supone abierta: un corte a
            // mitad de guardar podía dejar una jornada fantasma. Cerrada es lo
            // seguro; si el servidor la tiene abierta, se adopta al ponerse al
            // día (ADOPTED_REMOTE).
            val open = db?.getMeta(KEY_JOURNEY_OPEN_META) == "1"
            return LocalJourney(metaId, metaAt, open)
        }
        // Herencia de instalaciones previas: solo prefs.
        val prefs = PreferenceManager.getDefaultSharedPreferences(appContext)
        if (!prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)) return null
        val id = prefs.getLong(DmujeresApi.KEY_JOURNEY_ID, 0L)
        if (id <= 0L) return null
        return LocalJourney(id.toString(), prefs.getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L), true)
    }

    /** Persiste la jornada en meta y espeja prefs (la UI existente lee prefs). */
    fun persistLocal(journeyId: String, startedAtMs: Long, open: Boolean) {
        runCatching {
            DatabaseHelper(appContext).apply {
                putMeta(DatabaseHelper.KEY_JOURNEY_ID, journeyId)
                putMeta(DatabaseHelper.KEY_JOURNEY_STARTED_AT, startedAtMs.toString())
                putMeta(KEY_JOURNEY_OPEN_META, if (open) "1" else "0")
            }
        }
        PreferenceManager.getDefaultSharedPreferences(appContext).edit()
            .putLong(DmujeresApi.KEY_JOURNEY_ID, journeyId.toLongOrNull() ?: 0L)
            .putLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, startedAtMs)
            .putBoolean(DmujeresApi.KEY_JOURNEY_OPEN, open)
            .apply()
    }

    /**
     * Copia las preferencias a meta al arrancar el registro, para que una
     * jornada abierta antes de actualizar la app no se pierda.
     */
    fun syncFromPrefs() {
        val prefs = PreferenceManager.getDefaultSharedPreferences(appContext)
        val open = prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
        val id = prefs.getLong(DmujeresApi.KEY_JOURNEY_ID, 0L)
        if (id <= 0L && !open) return
        runCatching {
            val db = DatabaseHelper(appContext)
            val metaId = db.getMeta(DatabaseHelper.KEY_JOURNEY_ID)
            if (metaId.isNullOrBlank() && id > 0L) {
                db.putMeta(DatabaseHelper.KEY_JOURNEY_ID, id.toString())
                db.putMeta(
                    DatabaseHelper.KEY_JOURNEY_STARTED_AT,
                    prefs.getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L).toString(),
                )
            }
            db.putMeta(KEY_JOURNEY_OPEN_META, if (open) "1" else "0")
        }
    }

    /**
     * Se pone al día con el servidor al arrancar, en un hilo propio, sin
     * frenar la captura. La decisión la toma [decide].
     */
    fun reconcileAtStartup(onDone: ((ReconcileOutcome) -> Unit)? = null) {
        Thread {
            val outcome = try {
                reconcileNow()
            } catch (e: Exception) {
                Log.w(TAG, "reconciliación sin red: se conserva lo local", e)
                ReconcileOutcome.FALLBACK_LOCAL
            }
            onDone?.invoke(outcome)
        }.start()
    }

    private fun reconcileNow(): ReconcileOutcome {
        val remote = fetchRemote() ?: return ReconcileOutcome.FALLBACK_LOCAL
        val outcome = decide(local(), remote)
        // La persona la cerró y el aviso todavía no llegó al servidor (sin red
        // o la app se reinició antes): la jornada sigue cerrada. Se reenvía el
        // aviso en vez de reabrirla.
        if (outcome == ReconcileOutcome.ADOPTED_REMOTE &&
            JourneyOutbox.hasPendingStop(appContext, remote.journeyId.toLongOrNull() ?: 0L)
        ) {
            Log.i(TAG, "jornada ${remote.journeyId} cerrada en el teléfono con aviso pendiente: no se adopta")
            DmujeresApi.flushJourneyEvents(appContext)
            return ReconcileOutcome.KEPT_LOCAL
        }
        if (outcome == ReconcileOutcome.ADOPTED_REMOTE) {
            persistLocal(remote.journeyId, remote.startedAtMs, open = true)
            Log.i(TAG, "jornada adoptada del servidor: ${remote.journeyId}")
        }
        return outcome
    }

    companion object {
        private val TAG = JourneyManager::class.java.simpleName
        const val PATH_JOURNEY = "/api/mobile/v1/journey"
        private const val KEY_JOURNEY_OPEN_META = "journey_open"

        /**
         * Decide qué hacer: nunca se pisa una jornada abierta en el teléfono
         * (el servidor ya las revisa cada hora); solo se adopta la del
         * servidor si en el teléfono no hay ninguna abierta.
         */
        /**
         * Hora de inicio que manda el servidor: texto ISO en UTC
         * (`2026-09-30T20:03:34.000Z`) o milisegundos. Leerla como número daba
         * 0 y la jornada adoptada nunca se partía a medianoche.
         */
        fun parseStartedAt(value: Any?): Long = when (value) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull() ?: runCatching {
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                    isLenient = false
                }.parse(value)?.time
            }.getOrNull() ?: 0L
            else -> 0L
        }

        fun decide(local: LocalJourney?, remote: RemoteJourney?): ReconcileOutcome {
            if (remote == null) return ReconcileOutcome.FALLBACK_LOCAL
            if (local?.open == true) {
                return if (remote.open && remote.journeyId == local.journeyId) {
                    ReconcileOutcome.IN_SYNC
                } else {
                    ReconcileOutcome.KEPT_LOCAL
                }
            }
            return if (remote.open) ReconcileOutcome.ADOPTED_REMOTE else ReconcileOutcome.IN_SYNC
        }
    }

    /** GET /api/mobile/v1/journey; null si el servidor no la tiene o no hay red. */
    private fun fetchRemote(): RemoteJourney? {
        val base = DmujeresApi.webBase(appContext)
        val prefs = PreferenceManager.getDefaultSharedPreferences(appContext)
        val device = prefs.getString(Prefs.DEVICE, "").orEmpty().trim()
        if (base.isBlank() || device.isBlank()) return null
        val connection = URL(base + PATH_JOURNEY).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            val hadToken = DmujeresApi.setAuthHeaders(connection, appContext)
            connection.setRequestProperty("X-Device-Id", device)
            if (connection.responseCode == 404) return null // servidor sin esta ruta
            if (connection.responseCode !in 200..299) {
                // 401 con token: sesión terminada, se pedirá login (sin reintento).
                DmujeresApi.noteHttpResult(appContext, connection.responseCode, hadToken)
                return null
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val estado = json.optString("estado")
            return RemoteJourney(
                open = estado.equals("abierta", ignoreCase = true) || estado.equals("open", ignoreCase = true),
                journeyId = json.optString("journeyId").ifBlank { json.optLong("journeyId", 0L).toString() },
                startedAtMs = parseStartedAt(json.opt("inicioEn") ?: json.opt("startedAt")),
            )
        } catch (e: Exception) {
            Log.w(TAG, "GET journey falló", e)
            return null
        } finally {
            connection.disconnect()
        }
    }
}

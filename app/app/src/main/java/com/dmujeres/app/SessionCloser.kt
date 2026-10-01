package com.dmujeres.app

import android.content.Context
import android.util.Log
import androidx.preference.PreferenceManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import com.dmujeres.app.journey.JourneyManager
import com.dmujeres.app.sync.UploadPolicy
import com.dmujeres.app.sync.UploadQueue
import java.net.HttpURLConnection
import java.net.URL

/**
 * Cierre de sesión ordenado (solo desde el menú de depuración).
 *
 * `cerrarSesionLimpia()` corre en segundo plano, con tope de unos 30 s
 * ([SessionClosePlan.TIMEOUT_MS]), y avisa el avance con [onProgress] (se
 * llama desde ese hilo; la pantalla tiene que volver al principal). Pasos:
 *
 * a. Deja de aceptar puntos nuevos ([TrackingController.captureFrozen]).
 * b. Envía la cola pendiente por lotes hasta vaciarla o llegar al tope. Cada
 *    lote va con el `X-Device-Id` del equipo con que se capturó. Si llega un
 *    401 con token, se pasa al paso c con lo que quede (sigue guardado).
 * c. Cierra la jornada abierta. Si el servidor ya la tenía cerrada, no es
 *    error. En el teléfono siempre queda cerrada; al volver a entrar se
 *    revisa con GET /journey.
 * d. Borra la sesión (token, usuario y marcas) y abre `LoginActivity`. La
 *    clave compartida no se toca.
 *
 * Lo que no se pudo enviar nunca se borra: el informe trae `remaining` y la
 * pantalla avisa que se enviará al entrar de nuevo (sale primero, por ser lo
 * más viejo).
 */
object SessionCloser {

    private val TAG = SessionCloser::class.java.simpleName

    /** POST de jornada (mismo canal que [DmujeresApi.journeyEnded]). */
    private const val CLIENT = "dmujeres-app"

    /**
     * Cierre limpio con tope y progreso. Nunca lanza: ante un fallo
     * inesperado devuelve el informe con la sesión intacta.
     */
    suspend fun cerrarSesionLimpia(
        context: Context,
        onProgress: (enviadas: Int, restantes: Int) -> Unit = { _, _ -> },
    ): SessionClosePlan.CloseReport = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        // a. No se aceptan más puntos en la cola.
        TrackingController.captureFrozen = true
        try {
            var sent = 0
            val driver = object : SessionClosePlan.Driver {
                override fun pendingCount(): Int =
                    runCatching { DatabaseHelper(app).countPositions() }.getOrDefault(-1)

                override fun sendBatch(maxBatch: Int): SessionClosePlan.SendResult =
                    flushOneBatch(app, maxBatch)

                override fun endJourney(): SessionClosePlan.JourneyOutcome =
                    endJourneySync(app)

                override fun clearSession() = clearSessionLocal(app)

                override fun nowMs(): Long = System.currentTimeMillis()
            }
            SessionClosePlan.run(
                driver,
                onBatchConfirmed = { confirmed ->
                    sent += confirmed
                    val remaining = runCatching { DatabaseHelper(app).countPositions() }
                        .getOrDefault(-1)
                    runCatching { onProgress(sent, remaining) }
                },
            )
        } catch (e: Exception) {
            Log.w(TAG, "cierre interrumpido, sesión intacta", e)
            SessionClosePlan.CloseReport(
                sent = 0,
                remaining = runCatching { DatabaseHelper(app).countPositions() }.getOrDefault(-1),
                authFailed = false,
                journey = SessionClosePlan.JourneyOutcome.OFFLINE,
                sessionCleared = false,
            )
        } finally {
            // La captura siempre se reanuda: el cierre no deja el registro
            // congelado.
            TrackingController.captureFrozen = false
        }
    }

    // ── b. Vaciar la cola ────────────────────────────────────────────────

    /**
     * Envía UN lote. Solo sale de la base lo que el servidor confirma.
     */
    private fun flushOneBatch(app: Context, maxBatch: Int): SessionClosePlan.SendResult {
        val db = runCatching { DatabaseHelper(app) }.getOrNull()
            ?: return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        val window = runCatching { db.selectPositions(maxBatch) }
            .getOrDefault(emptyList())
            .filter { it.status != STATUS_DEAD }
        if (window.isEmpty()) return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.EMPTY)
        // Un lote por equipo de captura, el más viejo primero.
        val current = PreferenceManager.getDefaultSharedPreferences(app)
            .getString(Prefs.DEVICE, "").orEmpty().trim().lowercase()
        val group = UploadPolicy
            .groupByCaptureDevice(window, current) { it.captureDeviceId }
            .first()
        val batch = group.items
        val deviceId = group.deviceId
        runCatching { db.addAttempts(batch.map { it.id }) }
        if (deviceId.isBlank()) {
            // Sin identidad no se envía: queda para la próxima sesión.
            return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        }
        val (code, body, hadToken) = runCatching { postBatch(app, deviceId, batch) }.getOrNull()
            ?: return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        return when (UploadPolicy.classifyHttp(code)) {
            UploadPolicy.HttpClass.CONFIRMED -> applyBatchResult(db, batch, body)
            UploadPolicy.HttpClass.DEAD -> {
                if (code == 404) {
                    // El servidor no tiene la ruta de lotes: de a uno por OsmAnd.
                    flushLegacyOneByOne(app, db, batch, deviceId)
                } else {
                    // El servidor lo rechaza (400/413/422): no se reintenta y
                    // queda contado en meta.
                    runCatching { db.markDead(batch.map { it.id }) }
                    SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.SENT)
                }
            }
            UploadPolicy.HttpClass.PAUSED -> {
                if (hadToken) {
                    // Token muerto a mitad: se limpia la marca de sesión aquí
                    // (el paso d la deja en limpio definitivo) y se sigue al
                    // fin con lo que quede, sin perder datos.
                    DmujeresApi.noteHttpResult(app, code, hadToken = true)
                } else {
                    Log.w(TAG, "cierre pausado por 401 sin token")
                    StatusActivity.addMessage("Clave móvil inválida (401): subida pausada")
                }
                SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.AUTH_PAUSED)
            }
            UploadPolicy.HttpClass.RETRY ->
                SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        }
    }

    @Throws(Exception::class)
    private fun postBatch(
        app: Context,
        deviceId: String,
        batch: List<Position>,
    ): Triple<Int, String, Boolean> {
        val connection = URL(DmujeresApi.webBase(app) + UploadQueue.PATH_POSITIONS)
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            // Timeouts más cortos que la cola (15 s): el cierre tiene tope ~30 s.
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            val hadToken = DmujeresApi.setAuthHeaders(connection, app)
            connection.setRequestProperty("X-Device-Id", deviceId)
            val body = JSONObject().put("eventos", JSONArray().also { array ->
                for (position in batch) array.put(eventJson(position))
            })
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = runCatching { stream?.bufferedReader()?.use { it.readText() }.orEmpty() }
                .getOrDefault("")
            return Triple(code, text, hadToken)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Aplica la respuesta del lote: borra solo lo confirmado (accepted o
     * duplicate) y marca como descartado lo rechazado. Si la respuesta no
     * menciona algo, no se borra (se reintenta).
     */
    private fun applyBatchResult(
        db: DatabaseHelper,
        batch: List<Position>,
        response: String,
    ): SessionClosePlan.SendResult {
        val batchPairs = batch.map { it.id to it.localSequence }
        val match: UploadPolicy.BatchMatch
        try {
            val resultados = JSONObject(response).getJSONArray("resultados")
            val entries = ArrayList<Pair<Long, String>>(resultados.length())
            for (i in 0 until resultados.length()) {
                val item = resultados.getJSONObject(i)
                entries.add(item.optLong("seq") to item.optString("estado"))
            }
            // Mismo emparejado 1-a-1 que la cola (ver UploadPolicy): cada
            // mención consume una sola fila, en orden.
            match = UploadPolicy.matchBatchResults(batchPairs, entries)
        } catch (e: Exception) {
            Log.w(TAG, "lote 2xx sin cuerpo válido: se conserva", e)
            return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        }
        val confirmed = match.confirmedIds
        val dead = match.deadIds
        runCatching { db.deletePositions(confirmed) }
        if (dead.isNotEmpty()) runCatching { db.markDead(dead) }
        if (confirmed.isEmpty() && dead.isEmpty()) {
            return SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        }
        return SessionClosePlan.SendResult(confirmed.size, SessionClosePlan.BatchOutcome.SENT)
    }

    /**
     * Envío de a uno por OsmAnd, en orden (se detiene al primer fallo). El
     * `id` es el equipo de captura del grupo.
     */
    private fun flushLegacyOneByOne(
        app: Context,
        db: DatabaseHelper,
        batch: List<Position>,
        deviceId: String,
    ): SessionClosePlan.SendResult {
        val url = PreferenceManager.getDefaultSharedPreferences(app)
            .getString(Prefs.URL, "").orEmpty()
        val confirmed = ArrayList<Long>()
        var failed = false
        for (position in batch) {
            val identified = if (deviceId.isNotBlank()) {
                position.copy(deviceId = deviceId)
            } else {
                position
            }
            val ok = runCatching {
                RequestManager.sendRequest(ProtocolFormatter.formatRequest(url, identified))
            }.getOrDefault(false)
            if (ok) {
                confirmed.add(position.id)
            } else {
                failed = true
                break
            }
        }
        runCatching { db.deletePositions(confirmed) }
        return if (confirmed.isEmpty() && failed) {
            SessionClosePlan.SendResult(0, SessionClosePlan.BatchOutcome.RETRY_LATER)
        } else {
            SessionClosePlan.SendResult(confirmed.size, SessionClosePlan.BatchOutcome.SENT)
        }
    }

    private fun eventJson(position: Position): JSONObject = JSONObject()
        .put("bootId", position.bootId)
        .put("seq", position.localSequence)
        .put("journeyId", position.journeyId)
        .put("capturedAt", position.time.time)
        .put("lat", position.latitude)
        .put("lon", position.longitude)
        .put("alt", position.altitude)
        .put("speed", position.speed)
        .put("bearing", position.course)
        .put("accuracy", position.accuracy)
        .put("battery", position.battery)
        .put("charging", position.charging)
        .put("mock", position.mock)
        .put("provider", position.provider)
        .put("movementState", position.movementState)

    // ── c. Finalizar la jornada ──────────────────────────────────────────

    /**
     * Cierra la jornada abierta. En el teléfono siempre queda cerrada, para
     * que la próxima sesión no tenga dos abiertas; el informe dice si el
     * servidor lo confirmó. Sin jornada abierta no hace nada.
     */
    private fun endJourneySync(app: Context): SessionClosePlan.JourneyOutcome {
        val manager = JourneyManager(app)
        val local = runCatching { manager.local() }.getOrNull()
        val prefs = PreferenceManager.getDefaultSharedPreferences(app)
        val openPrefs = prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
        if (local?.open != true && !openPrefs) {
            return SessionClosePlan.JourneyOutcome.ALREADY_CLOSED
        }
        val journeyId = local?.journeyId?.toLongOrNull()
            ?: prefs.getLong(DmujeresApi.KEY_JOURNEY_ID, System.currentTimeMillis())
        val startedAt = if (local != null) local.startedAtMs
        else prefs.getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L)
        // Cierre local primero: la próxima sesión parte de "cerrada" y adopta
        // lo que diga el servidor (nunca dos abiertas locales).
        prefs.edit().putBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false).apply()
        val metaId = local?.journeyId?.ifBlank { null } ?: journeyId.toString()
        if (metaId.isNotBlank()) {
            runCatching { manager.persistLocal(metaId, startedAt, open = false) }
        }
        return try {
            postJourneyStop(app, journeyId)
        } catch (e: Exception) {
            Log.w(TAG, "fin de jornada sin red: queda cerrada en el teléfono", e)
            SessionClosePlan.JourneyOutcome.OFFLINE
        }
    }

    @Throws(Exception::class)
    private fun postJourneyStop(app: Context, journeyId: Long): SessionClosePlan.JourneyOutcome {
        val base = DmujeresApi.webBase(app)
        val device = PreferenceManager.getDefaultSharedPreferences(app)
            .getString(Prefs.DEVICE, "").orEmpty().trim().lowercase()
        if (base.isBlank() || device.isBlank()) {
            return SessionClosePlan.JourneyOutcome.OFFLINE
        }
        val connection = URL(base + JourneyManager.PATH_JOURNEY).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            DmujeresApi.setAuthHeaders(connection, app)
            connection.setRequestProperty("X-Device-Id", device)
            val body = JSONObject()
                .put("deviceId", device)
                .put("action", "stop")
                .put("journeyId", journeyId)
                .put("client", CLIENT)
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            return when (val code = connection.responseCode) {
                in 200..299 -> {
                    StatusActivity.addMessage(app.getString(R.string.journey_ended_toast))
                    SessionClosePlan.JourneyOutcome.CLOSED
                }
                // El servidor ya la tenía cerrada: sin error.
                400, 404, 409, 410, 422 -> SessionClosePlan.JourneyOutcome.ALREADY_CLOSED
                401, 403 -> SessionClosePlan.JourneyOutcome.AUTH_FAILED
                else -> {
                    Log.w(TAG, "fin de jornada respondió $code")
                    SessionClosePlan.JourneyOutcome.OFFLINE
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    // ── d. Limpiar la sesión ─────────────────────────────────────────────

    /**
     * Borra token, usuario y marcas. El equipo (Prefs.DEVICE) y la clave
     * compartida se mantienen: cambia la persona, el teléfono es el mismo. Lo
     * no enviado queda guardado para el próximo envío.
     */
    private fun clearSessionLocal(app: Context) {
        SessionStore.clear(app)
        Log.i(TAG, "sesión finalizada (cierre limpio)")
    }
}

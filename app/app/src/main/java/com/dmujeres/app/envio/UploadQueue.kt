package com.dmujeres.app.envio

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.preference.PreferenceManager
import org.json.JSONArray
import org.json.JSONObject
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.seguimiento.Position
import com.dmujeres.app.red.ProtocolFormatter
import com.dmujeres.app.red.RequestManager
import com.dmujeres.app.sistema.SendWakeLock
import com.dmujeres.app.sesion.SessionStore
import com.dmujeres.app.pantallas.StatusActivity
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.min
import kotlin.random.Random

/**
 * Reglas de subida sin Android (se prueban en la computadora): qué hacer con
 * cada respuesta del servidor y cuánto esperar antes de reintentar.
 */
object UploadPolicy {

    /** Base del backoff exponencial: 5 s, ×2, tope 5 min. */
    const val BASE_BACKOFF_MS = 5_000L
    const val MAX_BACKOFF_MS = 5 * 60_000L

    /** Máximo de puntos por lote. */
    const val MAX_BATCH = 50

    enum class HttpClass { CONFIRMED, RETRY, DEAD, PAUSED }

    /**
     * Qué hacer con cada respuesta: 2xx confirmado,
     * 400/404/413 DEAD sin reintento, 401 pausa con aviso, 408/429/5xx retry.
     */
    fun classifyHttp(code: Int): HttpClass = when (code) {
        in 200..299 -> HttpClass.CONFIRMED
        400, 404, 413, 422 -> HttpClass.DEAD
        401, 403 -> HttpClass.PAUSED
        else -> HttpClass.RETRY
    }

    /**
     * Espera entre reintentos: crece al doble con cada fallo, con tope, y
     * varía ±20 % al azar para que los teléfonos no reintenten todos a la vez.
     */
    fun backoffMs(failures: Int, jitter01: Double = Random.nextDouble()): Long {
        val grown = BASE_BACKOFF_MS shl min(failures, 10)
        val capped = min(grown, MAX_BACKOFF_MS)
        val jitter = 0.8 + 0.4 * jitter01.coerceIn(0.0, 1.0)
        return (capped * jitter).toLong().coerceAtLeast(BASE_BACKOFF_MS)
    }

    /** Un paso de la cola que lleva más de esto ocupado se da por colgado. */
    const val BUSY_STUCK_MS = 2 * 60_000L

    /**
     * ¿Se puede dar por colgado un paso de la cola? Cada envío tiene tope de
     * 15 s de conexión y 15 s de lectura; pasados 2 min algo se quedó
     * esperando (DNS, red que se cayó a mitad) y sin esta salida la cola no
     * volvía a subir nada hasta reiniciar la app.
     */
    fun isBusyStuck(busySinceMs: Long, nowMs: Long): Boolean =
        busySinceMs > 0L && nowMs - busySinceMs >= BUSY_STUCK_MS

    /** Respuesta del servidor por punto: accepted, duplicate, invalid o dead. */
    enum class EventResult { CONFIRMED, DEAD, UNKNOWN }

    fun classifyEvent(estado: String): EventResult = when (estado.lowercase()) {
        "accepted", "duplicate" -> EventResult.CONFIRMED
        "invalid", "dead" -> EventResult.DEAD
        else -> EventResult.UNKNOWN
    }

    /** Qué sigue tras procesar el `resultados` de un lote 2xx. */
    enum class BatchFollowUp { CONTINUE, BACKOFF }

    /**
     * Si el servidor confirmó algo, se sigue con el próximo lote enseguida. Si
     * no confirmó nada (respuesta vacía o estados desconocidos), se espera
     * antes de reintentar, para no reenviar el mismo lote en bucle.
     */
    fun followUpAfterBatch(confirmed: Int, dead: Int): BatchFollowUp =
        if (confirmed == 0 && dead == 0) BatchFollowUp.BACKOFF else BatchFollowUp.CONTINUE

    /**
     * Une cada resultado del servidor con UNA fila del lote por `seq`, en
     * orden: cada confirmación consume una sola fila, aunque haya dos filas
     * con la misma secuencia. Lo que el servidor no menciona queda para el
     * siguiente intento; nunca se borra sin confirmación.
     *
     * @param batch pares (rowId, seq) del lote enviado.
     * @param resultados pares (seq, estado) como vinieron del servidor.
     */
    data class BatchMatch(val confirmedIds: List<Long>, val deadIds: List<Long>)

    fun matchBatchResults(
        batch: List<Pair<Long, Long>>,
        resultados: List<Pair<Long, String>>,
    ): BatchMatch {
        val pending = batch.groupBy({ it.second }, { it.first })
            .mapValues { ArrayDeque(it.value) }
        val confirmed = ArrayList<Long>()
        val dead = ArrayList<Long>()
        for ((seq, estado) in resultados) {
            val row = pending[seq]?.removeFirstOrNull() ?: continue
            when (classifyEvent(estado)) {
                EventResult.CONFIRMED -> confirmed.add(row)
                EventResult.DEAD -> dead.add(row)
                EventResult.UNKNOWN -> Unit // se reintenta: no se consume
            }
        }
        return BatchMatch(confirmed, dead)
    }

    /** Un lote homogéneo: todas sus filas se capturaron con [deviceId]. */
    data class DeviceBatch<T>(val deviceId: String, val items: List<T>)

    /**
     * Agrupa un tramo de la cola por el equipo con que se capturó cada fila
     * ([deviceIdOf]), respetando el orden de la cola. El primer grupo es el de
     * la fila más vieja. Las filas sin equipo de captura usan
     * [currentDeviceId].
     *
     * Cada grupo se envía con su propio `X-Device-Id`: si se subiera con el
     * equipo actual algo capturado con otro, la misma ruta quedaría guardada
     * en dos equipos.
     */
    fun <T> groupByCaptureDevice(
        rows: List<T>,
        currentDeviceId: String,
        deviceIdOf: (T) -> String,
    ): List<DeviceBatch<T>> {
        val fallback = currentDeviceId.trim().lowercase()
        val groups = LinkedHashMap<String, MutableList<T>>()
        for (row in rows) {
            val device = deviceIdOf(row).trim().lowercase().ifBlank { fallback }
            groups.getOrPut(device) { ArrayList() }.add(row)
        }
        return groups.map { DeviceBatch(it.key, it.value) }
    }
}

/**
 * Cola de subida en orden estricto (leer, enviar, confirmar, borrar), sin
 * carreras. Tiene su propio estado (espera entre reintentos, pausa por 401,
 * soporte de lote); el controlador solo la activa con `kick()` y recibe sus
 * avisos.
 *
 * Usa `POST /api/mobile/v1/positions` (hasta 50 puntos). Si el servidor no
 * tiene esa ruta (404), envía de a un punto por OsmAnd.
 */
class UploadQueue(
    context: Context,
    private val databaseHelper: DatabaseHelper,
    private val listener: Listener,
) {

    interface Listener {
        /** Un drenado confirmó eventos: la cola fluye (cierra RECOVERING). */
        fun onQueueFlowing(confirmed: Int)

        /** Puntos descartados por el servidor (dead); no se reintentan. */
        fun onEventsDead(count: Int)

        /** 401: clave móvil inválida, cola pausada hasta aviso contrario. */
        fun onAuthPaused()
    }

    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val wakeLockEnabled: Boolean =
        PreferenceManager.getDefaultSharedPreferences(context).getBoolean(Prefs.WAKELOCK, true)

    @Volatile
    private var busy = false

    /** Desde cuándo está ocupada (para soltarla si se cuelga). */
    @Volatile
    private var busySince = 0L

    @Volatile
    private var pausedAuth = false

    /**
     * Clave y token que había al pausar por un 401. Solo se reanuda cuando
     * cambian (nuevo inicio de sesión o clave corregida), para no repetir el
     * mismo 401 en bucle.
     */
    @Volatile
    private var pausedToken = ""

    @Volatile
    private var pausedApiKey = ""

    @Volatile
    private var batchSupported = true

    @Volatile
    private var consecutiveFailures = 0

    /**
     * Último estado de la red según el controlador (la cola no mira la red
     * por su cuenta).
     */
    @Volatile
    private var lastOnline = true

    /** Activa la cola (punto nuevo, vuelve la red, botón actualizar, rescate). */
    fun kick(online: Boolean) {
        lastOnline = online
        if (busy) {
            if (!UploadPolicy.isBusyStuck(busySince, System.currentTimeMillis())) return
            Log.w(TAG, "paso de cola colgado: se suelta y se reintenta")
            busy = false
        }
        if (pausedAuth) {
            // Solo se reanuda si cambiaron la clave o el token desde la pausa.
            if (UploadAuthPolicy.shouldResumeAfterAuthChange(
                    pausedToken, pausedApiKey,
                    currentToken(), currentApiKey(),
                )
            ) {
                resume()
                Log.i(TAG, "auth cambió desde la pausa: cola reanudada")
            } else {
                return
            }
        }
        if (!online) return
        busy = true
        busySince = System.currentTimeMillis()
        Thread { step() }.start()
    }

    /** Reanuda tras una pausa por 401 (el usuario ya corrigió la clave). */
    fun resume() {
        pausedAuth = false
        pausedToken = ""
        pausedApiKey = ""
        consecutiveFailures = 0
    }

    private fun currentToken(): String = SessionStore.token(appContext)

    private fun currentApiKey(): String = DmujeresApi.apiKey(appContext)

    private fun step() {
        try {
            val window = runCatching { databaseHelper.selectPositions(UploadPolicy.MAX_BATCH) }
                .getOrDefault(emptyList())
                .filter { it.status != com.dmujeres.app.seguimiento.STATUS_DEAD }
            if (window.isEmpty()) {
                DmujeresApi.revisarCierreTrasBaja(appContext)
                finishOk(0)
                return
            }
            // Cada lote lleva un solo equipo: el de captura de sus filas. El
            // primer grupo es el de la fila más vieja; los demás salen en los
            // pasos siguientes.
            val current = deviceId()
            val group = UploadPolicy
                .groupByCaptureDevice(window, current) { it.captureDeviceId }
                .first()
            runCatching { databaseHelper.addAttempts(group.items.map { it.id }) }
            if (batchSupported) {
                sendBatch(group.items, group.deviceId)
            } else {
                sendLegacyOneByOne(group.items, group.deviceId)
            }
        } catch (e: Throwable) {
            // También errores (memoria, pila): el paso termina y la cola sigue.
            Log.w(TAG, "paso de cola falló", e)
            scheduleRetry()
        }
    }

    // --- Lote ----------------------------------------------------------------

    private fun sendBatch(batch: List<Position>, deviceId: String) {
        if (deviceId.isBlank()) {
            finishIdle()
            return
        }
        val url = DmujeresApi.webBase(appContext) + PATH_POSITIONS
        val body = JSONObject().put("eventos", JSONArray().also { array ->
            for (position in batch) array.put(eventJson(position))
        })
        if (wakeLockEnabled) SendWakeLock.acquire(appContext)
        val (code, response, hadToken) = try {
            postJson(url, deviceId, body)
        } catch (e: Exception) {
            Log.w(TAG, "lote: sin red", e)
            if (wakeLockEnabled) SendWakeLock.release()
            scheduleRetry()
            return
        }
        if (wakeLockEnabled) SendWakeLock.release()
        when (UploadPolicy.classifyHttp(code)) {
            UploadPolicy.HttpClass.CONFIRMED -> applyBatchResult(batch, response)
            UploadPolicy.HttpClass.DEAD -> {
                if (code == 404) {
                    // El servidor no tiene la ruta de lotes: se envía de a uno.
                    batchSupported = false
                    Log.i(TAG, "lote no soportado (404): fallback a OsmAnd 1×1")
                    busy = false
                    sendLegacyOneByOne(batch, deviceId)
                } else {
                    Log.w(TAG, "lote DEAD ($code): no se reintenta")
                    runCatching { databaseHelper.markDead(batch.map { it.id }) }
                    listenerSafe { listener.onEventsDead(batch.size) }
                    finishOk(0)
                    kickNext()
                }
            }
            UploadPolicy.HttpClass.PAUSED -> {
                if (!UploadAuthPolicy.shouldLatchPause(code, hadToken)) {
                    // 401 con token = token muerto: se limpia la sesión y se
                    // reintenta UNA vez con la clave compartida (la app opera
                    // con ella hasta el próximo login). Si esa también falla,
                    // la siguiente vuelta pausa de verdad. Nunca se borra dato.
                    DmujeresApi.noteHttpResult(appContext, code, hadToken = true)
                    consecutiveFailures = 0
                    finishIdle()
                    kickNext()
                } else {
                    // Clave inválida o 403: se pausa guardando la clave y el
                    // token de ese momento, para reanudar cuando cambien (o con
                    // el botón actualizar).
                    pausedAuth = true
                    pausedToken = currentToken()
                    pausedApiKey = currentApiKey()
                    if (hadToken) {
                        // Token revocado o usuario deshabilitado: se borra la
                        // sesión y se pide entrar de nuevo.
                        DmujeresApi.noteHttpResult(appContext, code, hadToken = true)
                    } else {
                        Log.w(TAG, "cola pausada por 401: clave móvil inválida")
                        StatusActivity.addMessage("Clave móvil inválida (401): subida pausada")
                    }
                    listenerSafe { listener.onAuthPaused() }
                    finishIdle()
                }
            }
            UploadPolicy.HttpClass.RETRY -> scheduleRetry()
        }
    }

    private fun applyBatchResult(batch: List<Position>, response: String) {
        // Si la respuesta no se entiende no se borra nada: reintentar es
        // seguro porque el servidor no guarda repetidos.
        val batchPairs = batch.map { it.id to it.localSequence }
        val match: UploadPolicy.BatchMatch
        try {
            val resultados = JSONObject(response).getJSONArray("resultados")
            val entries = ArrayList<Pair<Long, String>>(resultados.length())
            for (i in 0 until resultados.length()) {
                val item = resultados.getJSONObject(i)
                entries.add(item.optLong("seq") to item.optString("estado"))
            }
            // Cada mención del servidor confirma una fila (ver UploadPolicy);
            // lo no mencionado se reintenta.
            match = UploadPolicy.matchBatchResults(batchPairs, entries)
        } catch (e: Exception) {
            Log.w(TAG, "lote 2xx sin cuerpo válido: se reintenta", e)
            scheduleRetry()
            return
        }
        // Lo que el servidor no mencionó no se borra.
        runCatching { databaseHelper.deletePositions(match.confirmedIds) }
        if (match.deadIds.isNotEmpty()) {
            runCatching { databaseHelper.markDead(match.deadIds) }
            listenerSafe { listener.onEventsDead(match.deadIds.size) }
        }
        consecutiveFailures = 0
        if (match.confirmedIds.isNotEmpty()) {
            listenerSafe { listener.onQueueFlowing(match.confirmedIds.size) }
        }
        if (UploadPolicy.followUpAfterBatch(match.confirmedIds.size, match.deadIds.size) ==
            UploadPolicy.BatchFollowUp.BACKOFF
        ) {
            // 2xx sin avance del cursor (vacío o estados desconocidos):
            // backoff en vez de reenviar el mismo lote en bucle apretado.
            scheduleRetry()
            return
        }
        finishOk(match.confirmedIds.size)
        // Serie estricta: si queda más, sigue en el mismo impulso.
        kickNext()
    }

    // --- Envío de a uno por OsmAnd ----------------------------------------------

    /**
     * Para servidores sin la ruta de lotes: un punto por pedido, en orden. Si
     * sale bien se borra; si falla se reintenta después. El `id` es el equipo
     * de captura del grupo.
     */
    private fun sendLegacyOneByOne(batch: List<Position>, deviceId: String) {
        val url = PreferenceManager.getDefaultSharedPreferences(appContext)
            .getString(Prefs.URL, "").orEmpty()
        val confirmed = ArrayList<Long>()
        var failed = false
        for (position in batch) {
            val identified = if (deviceId.isNotBlank()) {
                position.copy(deviceId = deviceId)
            } else {
                position
            }
            if (wakeLockEnabled) SendWakeLock.acquire(appContext)
            val ok = try {
                RequestManager.sendRequest(ProtocolFormatter.formatRequest(url, identified))
            } catch (e: Exception) {
                false
            } finally {
                if (wakeLockEnabled) SendWakeLock.release()
            }
            if (ok) {
                confirmed.add(position.id)
            } else {
                failed = true
                break // en orden: al primer fallo se detiene
            }
        }
        runCatching { databaseHelper.deletePositions(confirmed) }
        if (confirmed.isNotEmpty()) {
            consecutiveFailures = 0
            listenerSafe { listener.onQueueFlowing(confirmed.size) }
        }
        finishOk(confirmed.size)
        if (failed) {
            scheduleRetry()
        } else {
            kickNext()
        }
    }

    // --- Utilidades ------------------------------------------------------------

    /** Serie estricta: al terminar un lote, sigue con el siguiente si hay. */
    private fun kickNext() {
        handler.post { kick(lastOnline) }
    }

    /**
     * Un aviso al controlador que falle no puede detener la cola: se registra
     * el error y se sigue (los borrados ya se hicieron antes). Sin esto la cola
     * quedaba trabada hasta reiniciar.
     */
    private inline fun listenerSafe(block: () -> Unit) {
        runCatching(block).onFailure { Log.w(TAG, "aviso al controlador falló", it) }
    }

    private fun finishOk(@Suppress("UNUSED_PARAMETER") confirmed: Int) {
        busy = false
    }

    private fun finishIdle() {
        busy = false
    }

    private fun scheduleRetry() {
        busy = false
        val delay = UploadPolicy.backoffMs(consecutiveFailures++)
        Log.i(TAG, "reintento en ${delay}ms")
        handler.postDelayed({ kick(lastOnline) }, delay)
    }

    private fun deviceId(): String =
        PreferenceManager.getDefaultSharedPreferences(appContext)
            .getString(Prefs.DEVICE, "").orEmpty().trim().lowercase()

    @Throws(Exception::class)
    private fun postJson(url: String, deviceId: String, body: JSONObject): Triple<Int, String, Boolean> {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            val hadToken = DmujeresApi.setAuthHeaders(connection, appContext)
            connection.setRequestProperty("X-Device-Id", deviceId)
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = runCatching { stream?.bufferedReader()?.use { it.readText() }.orEmpty() }.getOrDefault("")
            return Triple(code, text, hadToken)
        } finally {
            connection.disconnect()
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

    companion object {
        private val TAG = UploadQueue::class.java.simpleName
        const val PATH_POSITIONS = "/api/mobile/v1/positions"
    }
}

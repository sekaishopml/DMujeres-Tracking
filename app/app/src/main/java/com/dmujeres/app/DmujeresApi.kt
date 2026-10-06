package com.dmujeres.app

import android.content.Context
import android.util.Log
import androidx.preference.PreferenceManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Llamadas de la app al servidor que no son el envío de puntos:
 * - token de notificaciones (para la recuperación por push),
 * - inicio y fin de jornada,
 * - confirmación de recuperación,
 * - búsqueda de actualizaciones.
 *
 * Todo corre en hilos propios: nunca bloquea la pantalla ni el servicio.
 */
object DmujeresApi {

    private const val TAG = "DmujeresApi"
    const val KEY_JOURNEY_ID = "journeyId"
    private val ZONA_JORNADA = java.util.TimeZone.getTimeZone("America/Guayaquil")
    const val KEY_PASSWORD = "password"
    const val KEY_JOURNEY_STARTED_AT = "journeyStartedAt"
    const val KEY_JOURNEY_OPEN = "journeyOpen"
    private const val CLIENT = "dmujeres-app"
    private const val GITHUB_REPO = "sekaishopml/DMujeres-Tracking"

    private fun prefs(context: Context) =
        PreferenceManager.getDefaultSharedPreferences(context)

    private fun deviceId(context: Context): String =
        prefs(context).getString(Prefs.DEVICE, "").orEmpty().trim().lowercase()

    /**
     * Clave compartida del canal: la que se cargó en el teléfono o, si no, la
     * que trae la compilación. Se usa cuando no hay sesión guardada.
     */
    fun apiKey(context: Context): String =
        prefs(context).getString(KEY_PASSWORD, "").orEmpty()
            .ifBlank { BuildConfig.MOBILE_HTTP_API_KEY }

    /** ¿Hay sesión guardada (token)? Sin sesión se usa la clave compartida. */
    fun hasSession(context: Context): Boolean =
        SessionStore.hasSession(context)

    /** Usuario de la sesión actual (vacío si no hay sesión). */
    fun sessionUser(context: Context): String =
        SessionStore.user(context)

    /**
     * Cabeceras de autenticación: con sesión se manda el token
     * (`Authorization: Bearer`); sin sesión, la clave compartida. Devuelve true
     * si se mandó token (para saber qué hacer con un 401). Cada llamada pone
     * su `X-Device-Id`.
     */
    fun setAuthHeaders(connection: HttpURLConnection, context: Context): Boolean {
        val headers = SessionAuth.authHeaders(SessionStore.token(context), apiKey(context))
        for ((name, value) in headers) {
            connection.setRequestProperty(name, value)
        }
        return SessionStore.hasSession(context)
    }

    /**
     * 401 con token (sesión revocada o usuario deshabilitado): se borra la
     * sesión y se pide entrar de nuevo. No se reintenta. Sin token no hay
     * sesión que borrar (el 401 es de la clave compartida).
     */
    fun noteHttpResult(context: Context, code: Int, hadToken: Boolean) {
        if (!SessionAuth.shouldClearSession(code, hadToken)) return
        SessionStore.clearOnUnauthorized(context)
        Log.w(TAG, "sesión terminada por el servidor (401 con token): se pedirá login")
        StatusActivity.addMessage(context.getString(R.string.status_session_expired))
    }

    /** Cierre manual (debug): borra token y datos de sesión. */
    fun logout(context: Context) {
        SessionStore.clear(context)
        Log.i(TAG, "sesión cerrada manualmente")
    }

    /** Dirección del servidor web (puerto 999), sacada de la de OsmAnd (5055). */
    fun webBase(context: Context): String {
        val url = prefs(context).getString(Prefs.URL, "").orEmpty()
            .ifBlank { context.getString(R.string.settings_url_default_value) }
        return url.replace(":5055", ":999").trimEnd('/')
    }

    /** POST síncrono (hilo propio del llamador): true si respondió 2xx. */
    private fun postSync(context: Context, path: String, body: JSONObject): Boolean {
        val base = webBase(context)
        val device = deviceId(context)
        if (base.isBlank() || device.isBlank()) return false
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(base + path).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            val hadToken = setAuthHeaders(connection, context)
            connection.setRequestProperty("X-Device-Id", device)
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if (code !in 200..299) noteHttpResult(context, code, hadToken)
            // Otros 4xx (equipo desconocido, datos inválidos): el servidor no
            // lo va a aceptar nunca; se descarta para no trabar la cola.
            code in 200..299 || (code in 400..499 && code != 401 && code != 408 && code != 429)
        } catch (e: Exception) {
            Log.w(TAG, "POST $path falló", e)
            false
        } finally {
            runCatching { connection?.disconnect() }
        }
    }

    private fun post(context: Context, path: String, body: JSONObject, onDone: ((Boolean) -> Unit)? = null) {
        val base = webBase(context)
        val device = deviceId(context)
        if (base.isBlank() || device.isBlank()) {
            Log.w(TAG, "Sin URL o id configurado; se omite $path")
            onDone?.invoke(false)
            return
        }
        Thread {
            var ok = false
            try {
                val connection = URL(base + path).openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                val hadToken = setAuthHeaders(connection, context)
                connection.setRequestProperty("X-Device-Id", device)
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = connection.responseCode
                ok = code in 200..299
                if (!ok) {
                    Log.w(TAG, "$path respondió $code")
                    // 401 con token: limpiar y pedir login, sin reintentar en bucle.
                    noteHttpResult(context, code, hadToken)
                }
                connection.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "POST $path falló", e)
            }
            onDone?.invoke(ok)
        }.start()
    }

    /** Registra el token de notificaciones del equipo. */
    fun registerFcmToken(context: Context, token: String) {
        if (token.isBlank()) return
        post(
            context,
            "/api/mobile/v1/fcm-token",
            JSONObject().put("fcmToken", token).put("appVersion", BuildConfig.VERSION_NAME),
        )
    }

    /** Inicio de jornada: id = epoch ms, evento mobileJourneyStarted en el panel. */
    fun journeyStarted(context: Context) {
        // Doble toque o reintento: si ya hay jornada abierta no se abre otra.
        if (isJourneyOpen(context)) return
        val now = System.currentTimeMillis()
        val journeyId = now
        prefs(context).edit()
            .putLong(KEY_JOURNEY_ID, journeyId)
            .putLong(KEY_JOURNEY_STARTED_AT, now)
            .putBoolean(KEY_JOURNEY_OPEN, true)
            .apply()
        StatusActivity.addMessage(context.getString(R.string.journey_started_toast))
        JourneyOutbox.enqueue(context, "start", journeyId, now)
        flushJourneyEvents(context)
        // El GPS y el aviso de la barra siguen a la jornada sin esperar el pulso.
        TrackingService.syncJourneyNow()
    }

    fun isJourneyOpen(context: Context): Boolean =
        prefs(context).getBoolean(KEY_JOURNEY_OPEN, false)

    /** Hora local del inicio de jornada, para el texto "desde las HH:MM". */
    fun journeyStartedAtLabel(context: Context): String {
        val startedAt = prefs(context).getLong(KEY_JOURNEY_STARTED_AT, 0L)
        val format = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        return if (startedAt > 0L) format.format(java.util.Date(startedAt)) else "--:--"
    }

    // Próxima medianoche ya calculada: hasta entonces la revisión no hace nada.
    @Volatile private var proximaMedianoche = 0L

    /** Inicio del día (00:00 en Ecuador) que contiene [ms]. */
    fun inicioDelDia(ms: Long): Long = java.util.Calendar.getInstance(ZONA_JORNADA).apply {
        timeInMillis = ms
        set(java.util.Calendar.HOUR_OF_DAY, 0)
        set(java.util.Calendar.MINUTE, 0)
        set(java.util.Calendar.SECOND, 0)
        set(java.util.Calendar.MILLISECOND, 0)
    }.timeInMillis

    /**
     * Una jornada abierta que viene de otro día se parte a medianoche: se
     * cierra a las 23:59:59 y sigue como jornada nueva desde las 00:00, igual
     * que si la persona tocara Finalizar e Iniciar. Así cada día tiene su
     * jornada. El panel no lo notifica (cierre y apertura en el mismo minuto).
     */
    fun renovarSiCambioDeDia(context: Context, ahora: Long = System.currentTimeMillis()) {
        if (ahora < proximaMedianoche) return
        val hoy = inicioDelDia(ahora)
        proximaMedianoche = hoy + 24 * 3_600_000L
        if (!isJourneyOpen(context)) return
        val p = prefs(context)
        // Sin hora de inicio guardada, el id de la jornada (la hora en que
        // empezó) hace de inicio: así una jornada adoptada del servidor
        // también se parte.
        val idGuardado = p.getLong(KEY_JOURNEY_ID, 0L)
        val inicio = p.getLong(KEY_JOURNEY_STARTED_AT, 0L).takeIf { it > 0L } ?: idGuardado
        if (inicio <= 0L || inicio >= hoy) return
        val anterior = if (idGuardado > 0L) idGuardado else inicio
        p.edit()
            .putLong(KEY_JOURNEY_ID, hoy)
            .putLong(KEY_JOURNEY_STARTED_AT, hoy)
            .putBoolean(KEY_JOURNEY_OPEN, true)
            .commit()
        JourneyOutbox.enqueue(context, "stop", anterior, hoy - 1)
        JourneyOutbox.enqueue(context, "start", hoy, hoy)
        StatusActivity.addMessage(context.getString(R.string.journey_renewed))
        flushJourneyEvents(context)
    }

    /** Fin de jornada: cierra la jornada abierta (si la hay). */
    fun journeyEnded(context: Context) {
        val open = prefs(context).getBoolean(KEY_JOURNEY_OPEN, false)
        if (!open) return
        val journeyId = prefs(context).getLong(KEY_JOURNEY_ID, System.currentTimeMillis())
        prefs(context).edit().putBoolean(KEY_JOURNEY_OPEN, false).apply()
        StatusActivity.addMessage(context.getString(R.string.journey_ended_toast))
        JourneyOutbox.enqueue(context, "stop", journeyId, System.currentTimeMillis())
        flushJourneyEvents(context)
        // Se apaga el GPS y se sube lo que quedaba en la cola.
        TrackingService.syncJourneyNow()
    }

    /** Cronograma: actividades del equipo entre dos fechas (YYYY-MM-DD). null = sin conexión/error. */
    fun fetchActividades(context: Context, desde: String, hasta: String): org.json.JSONArray? {
        val base = webBase(context)
        val device = deviceId(context)
        if (base.isBlank() || device.isBlank()) return null
        var connection: HttpURLConnection? = null
        return try {
            connection = URL("$base/api/mobile/v1/actividades?deviceId=${java.net.URLEncoder.encode(device, "UTF-8")}&desde=$desde&hasta=$hasta")
                .openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            val hadToken = setAuthHeaders(connection, context)
            connection.setRequestProperty("X-Device-Id", device)
            val code = connection.responseCode
            if (code !in 200..299) {
                noteHttpResult(context, code, hadToken)
                null
            } else {
                JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optJSONArray("actividades")
            }
        } catch (e: Exception) {
            Log.w(TAG, "cronograma: no se pudo leer", e)
            null
        } finally {
            runCatching { connection?.disconnect() }
        }
    }

    /** Cronograma: alta, edición o baja (idempotente por clientId). */
    fun postActividad(context: Context, body: JSONObject): Boolean =
        postSync(context, "/api/mobile/v1/actividades", JSONObject(body.toString()).put("deviceId", deviceId(context)))

    /** Aviso de apagado/encendido (cola de PowerEvents). */
    fun postPowerEvent(context: Context, event: JSONObject): Boolean =
        postSync(context, "/api/mobile/v1/power", JSONObject(event.toString()).put("deviceId", deviceId(context)))

    private val flushing = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * Envía los avisos de jornada pendientes, en orden y con la hora real en
     * que se tocó el botón (`at`). Si no hay señal, se reintenta después
     * (desde el botón, el latido del servicio o la pantalla principal). Se
     * detiene al primer fallo para no desordenar inicio y fin. El servidor no
     * duplica por journeyId.
     */
    fun flushJourneyEvents(context: Context) {
        val app = context.applicationContext
        if (JourneyOutbox.peek(app) == null) return
        // Un solo envío a la vez: dos hilos mandaban el mismo aviso y el fin
        // repetido podía llegar después del inicio de la jornada nueva.
        if (!flushing.compareAndSet(false, true)) return
        Thread {
            try {
                while (true) {
                    val event = JourneyOutbox.peek(app) ?: break
                    val ok = postSync(
                        app,
                        "/api/mobile/v1/journey",
                        JSONObject()
                            .put("deviceId", deviceId(app))
                            .put("action", event.action)
                            .put("journeyId", event.journeyId)
                            .put("at", event.at)
                            .put("client", CLIENT),
                    )
                    if (!ok) {
                        StatusActivity.addMessage(app.getString(R.string.console_journey_queued))
                        break
                    }
                    JourneyOutbox.remove(app, event)
                    StatusActivity.addMessage(
                        app.getString(
                            if (event.action == "start") R.string.console_journey_start_ok else R.string.console_journey_stop_ok,
                        ),
                    )
                }
            } finally {
                flushing.set(false)
            }
        }.start()
    }

    /** Resultado de validar el acceso del colaborador en el servidor. */
    enum class LoginResult { AUTHORIZED, UNKNOWN_USER, BAD_CREDENTIALS, OFFLINE }

    /**
     * Revisa el usuario: 200 = autorizado, 404 = no existe, 401/403 = clave
     * incorrecta; cualquier otra cosa se toma como sin conexión.
     */
    fun checkLogin(context: Context, userId: String, key: String): LoginResult {
        val base = webBase(context)
        if (base.isBlank() || userId.isBlank()) return LoginResult.OFFLINE
        return try {
            val connection = URL("$base/api/mobile/v1/config").openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.setRequestProperty("X-Api-Key", key)
            connection.setRequestProperty("X-Device-Id", userId)
            val code = connection.responseCode
            connection.disconnect()
            when (code) {
                in 200..299 -> LoginResult.AUTHORIZED
                404 -> LoginResult.UNKNOWN_USER
                401, 403 -> LoginResult.BAD_CREDENTIALS
                else -> LoginResult.OFFLINE
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo validar el acceso", e)
            LoginResult.OFFLINE
        }
    }

    /**
     * Inicio de sesión con POST /api/mobile/v1/sesion {usuario, clave}.
     * Bloquea: llamar desde un hilo propio (como [checkLogin]).
     *
     * - 200: guarda el token en [SessionStore], el usuario y la
     *   `configuracion` recibida (solo claves conocidas) → AUTHORIZED.
     * - 401: usuario o clave incorrectos → BAD_CREDENTIALS.
     * - 404: el servidor no tiene /sesion; se valida con la clave compartida
     *   ([checkLogin]).
     * - Sin red u otro error → OFFLINE.
     */
    fun login(context: Context, usuario: String, clave: String): LoginResult {
        val user = SessionAuth.normalizeUser(usuario)
        if (user.isBlank() || clave.isBlank()) return LoginResult.OFFLINE
        val base = webBase(context)
        if (base.isBlank()) return LoginResult.OFFLINE
        val code: Int
        val body: String
        try {
            val connection = URL(base + SessionAuth.PATH_SESION).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use {
                it.write(SessionAuth.loginRequestJson(user, clave).toByteArray())
            }
            code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            body = runCatching { stream?.bufferedReader()?.use { it.readText() }.orEmpty() }.getOrDefault("")
            connection.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo iniciar sesión", e)
            return LoginResult.OFFLINE
        }
        return when (code) {
            in 200..299 -> {
                val token = SessionAuth.extractToken(body)
                if (token.isNullOrBlank()) {
                    Log.w(TAG, "sesion respondió 200 sin token")
                    return LoginResult.OFFLINE
                }
                val expiraEn = SessionAuth.extractExpiresInSeconds(body) ?: 0L
                val nombre = SessionAuth.extractDisplayName(body)
                val expiraEnMs = if (expiraEn > 0) System.currentTimeMillis() + expiraEn * 1_000 else 0L
                SessionStore.save(context, token, user, nombre, expiraEnMs)
                // Equipo de la persona: al entrar se adopta su identificador
                // para que la ruta quede bajo su equipo (aparece en Replay y
                // En vivo). Sin equipo vinculado, el móvil conserva el suyo.
                val equipo = SessionAuth.extractEquipoIdentificador(body)
                if (equipo.isNotBlank()) {
                    prefs(context).edit().putString(Prefs.DEVICE, equipo.lowercase()).apply()
                    Log.i(TAG, "la sesión adoptó el equipo $equipo")
                }
                val config = SessionAuth.extractConfigBlock(body)
                RemoteConfig.applySessionConfig(
                    context,
                    config?.let(SessionAuth::parseConfigBlock),
                )
                Log.i(TAG, "sesión iniciada para $user")
                LoginResult.AUTHORIZED
            }
            401 -> LoginResult.BAD_CREDENTIALS
            404 -> {
                // Servidor sin /sesion: se valida con la clave compartida.
                Log.i(TAG, "sesion no disponible (404): compatibilidad con clave compartida")
                val legacy = checkLogin(context, user, clave)
                if (legacy == LoginResult.AUTHORIZED) {
                    prefs(context).edit()
                        .putString(Prefs.DEVICE, user)
                        .putString(KEY_PASSWORD, clave)
                        .apply()
                }
                legacy
            }
            else -> LoginResult.OFFLINE
        }
    }

    /**
     * ¿El usuario existe en el servidor? null si no se pudo saber (sin red).
     * Usa la ruta de configuración: 200 = autorizado, 404 = no existe.
     */
    fun userExists(context: Context, userId: String): Boolean? {
        val base = webBase(context)
        if (base.isBlank() || userId.isBlank()) return null
        return try {
            val connection = URL("$base/api/mobile/v1/config").openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            val hadToken = setAuthHeaders(connection, context)
            connection.setRequestProperty("X-Device-Id", userId)
            val code = connection.responseCode
            connection.disconnect()
            noteHttpResult(context, code, hadToken)
            when (code) {
                in 200..299 -> true
                404 -> false
                else -> null
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo validar el usuario", e)
            null
        }
    }

    /** ¿El servidor responde ahora? (consulta corta a la configuración). */
    fun serverReachable(context: Context): Boolean {
        val base = webBase(context)
        val device = deviceId(context)
        if (base.isBlank() || device.isBlank()) return false
        return try {
            val connection = URL("$base/api/mobile/v1/config").openConnection() as HttpURLConnection
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            val hadToken = setAuthHeaders(connection, context)
            connection.setRequestProperty("X-Device-Id", device)
            val code = connection.responseCode
            connection.disconnect()
            noteHttpResult(context, code, hadToken)
            code in 200..499 // 404 también prueba que el servidor responde
        } catch (e: Exception) {
            false
        }
    }

    /** Reporte al canal de diagnósticos (crashes incluidos; ver panel). */
    fun postDiagnostics(context: Context, body: JSONObject) {
        post(context, "/api/mobile/v1/diagnostics", body)
    }

    /** Confirma al servidor que llegó el aviso de recuperación. */
    fun recoveryAck(context: Context, attemptId: String, stage: String) {
        if (attemptId.isBlank()) return
        post(
            context,
            "/api/mobile/v1/recovery-ack",
            JSONObject()
                .put("recoveryAttemptId", attemptId)
                .put("stage", stage)
                .put("priority", "high")
                .put("reason", "fcm"),
        )
    }

    /**
     * Busca actualización. [onUpdate] recibe (versión o null, url, sha256);
     * null = no hay versión mayor. Primero pregunta al servidor y, si el puerto
     * 999 no responde (en datos móviles puede estar bloqueado), mira el último
     * release de GitHub.
     */
    fun checkOta(context: Context, onUpdate: (String?, String, String) -> Unit) {
        val base = webBase(context)
        val device = deviceId(context)
        Thread {
            if (base.isNotBlank() && device.isNotBlank()) {
                val server = tryServerOta(base, device, context)
                if (server != null) {
                    onUpdate(server.first, server.second, server.third)
                    return@Thread
                }
            }
            val github = tryGithubRelease()
            if (github != null) {
                onUpdate(github.first, github.second, "")
            } else {
                onUpdate(null, "", "")
            }
        }.start()
    }

    /**
     * Pregunta al servidor. Devuelve el manifiesto solo si lo publicado es
     * mayor que lo instalado; null si no hay actualización o si hubo error
     * (401, 404, 500, sin red). Con error se prueba GitHub en esta vuelta y
     * al servidor en la siguiente. Un 401 con token borra la sesión y la
     * próxima vez se usa la clave compartida.
     */
    private fun tryServerOta(base: String, device: String, context: Context): Triple<String, String, String>? {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL("$base/api/mobile/v1/ota?deviceId=$device&versionCode=${BuildConfig.VERSION_CODE}")
            connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            val hadToken = setAuthHeaders(connection, context)
            val httpCode = runCatching { connection.responseCode }.getOrDefault(-1)
            noteHttpResult(context, httpCode, hadToken)
            // Respuesta no 2xx: se devuelve null y se prueba GitHub; la
            // próxima vuelta reintenta.
            if (httpCode !in 200..299) {
                Log.w(TAG, "OTA del servidor respondió $httpCode")
                return null
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val code = json.optInt("versionCode", 0)
            val apkUrl = json.optString("url")
            val sha = json.optString("sha256")
            if (OtaPolicy.isUpdateAvailable(code, BuildConfig.VERSION_CODE) && apkUrl.isNotBlank()) {
                Triple(json.optString("version", code.toString()), apkUrl, sha)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "OTA del servidor no disponible", e)
            null
        } finally {
            runCatching { connection?.disconnect() }
        }
    }

    /** Releases del repo raíz: tag vX.Y.Z + asset APK. Compara por nombre. */
    private fun tryGithubRelease(): Triple<String, String, String>? {
        return try {
            val connection = URL("https://api.github.com/repos/$GITHUB_REPO/releases/latest")
                .openConnection() as HttpURLConnection
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            val code = connection.responseCode
            val body = if (code in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                ""
            }
            connection.disconnect()
            if (body.isBlank()) return null
            val json = JSONObject(body)
            val tag = json.optString("tag_name").removePrefix("v")
            if (!isNewer(tag)) return null
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val url = assets.getJSONObject(i).optString("browser_download_url")
                if (url.endsWith(".apk")) return Triple(tag, url, "")
            }
            null
        } catch (e: Exception) {
            Log.w(TAG, "OTA de GitHub no disponible", e)
            null
        }
    }

    /** ¿La versión publicada es mayor que la instalada? (ver OtaPolicy). */
    private fun isNewer(candidate: String): Boolean =
        OtaPolicy.isNewerName(BuildConfig.VERSION_NAME, candidate)
}

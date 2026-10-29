package com.dmujeres.app.sistema

import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.actualizacion.OtaNotifier
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.datos.RemoteConfig
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.seguimiento.AdaptiveCadence
import com.dmujeres.app.seguimiento.PositionProvider
import com.dmujeres.app.seguimiento.Pasos
import com.dmujeres.app.seguimiento.TrackingController
import com.dmujeres.app.seguimiento.TrackingService
import com.dmujeres.app.envio.UploadQueue
import org.json.JSONObject

/**
 * Latido de diagnóstico.
 *
 * Con el servicio activo, cada 10 min y al arrancar, manda al servidor un
 * reporte: servicio activo, ubicación del sistema encendida, puntos sin
 * enviar, jornada y servidor configurado. Así el estado del teléfono se ve en
 * el panel (`lastDiagnostics`) y se puede saber por qué no llegan puntos.
 */
object ServiceHeartbeat {

    private const val TAG = "ServiceHeartbeat"
    private const val INTERVAL_MS = 10 * 60_000L
    private const val TEMPERATURA_MS = 5 * 60_000L

    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var running = false

    private var appContext: Context? = null

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            report()
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    // Temperatura de la batería cada 5 min. Se lee del aviso de batería que
    // Android ya tiene guardado (no enciende nada) y viaja con el diagnóstico.
    private val tickTemperatura = object : Runnable {
        override fun run() {
            if (!running) return
            medirTemperaturaSiToca()
            handler.postDelayed(this, TEMPERATURA_MS)
        }
    }

    private val temperaturas = ArrayList<Pair<Long, Double>>()

    @Volatile
    private var ultimaTemperaturaMs = 0L

    private fun medirTemperaturaSiToca() {
        val context = appContext ?: return
        val ahora = System.currentTimeMillis()
        // Medio minuto de margen: el pulso y la alarma no caen exactos.
        if (ahora - ultimaTemperaturaMs < TEMPERATURA_MS - 30_000L) return
        val grados = readBatteryStatus(context).temperatureC ?: return
        ultimaTemperaturaMs = ahora
        synchronized(temperaturas) {
            temperaturas.add(ahora to grados)
            if (temperaturas.size > 12) temperaturas.removeAt(0)
        }
    }

    fun start(context: Context) {
        if (running) return
        running = true
        appContext = context.applicationContext
        report()
        handler.postDelayed(tick, INTERVAL_MS)
        handler.postDelayed(tickTemperatura, TEMPERATURA_MS)
        Log.i(TAG, "latido de diagnóstico iniciado")
    }

    /**
     * Diagnóstico inmediato, sin esperar los 10 minutos: cuando se apaga o se
     * enciende la ubicación, el panel lo sabe enseguida.
     */
    fun reportNow() {
        if (running) report()
    }

    @Volatile
    private var ultimoReporteMs = 0L

    /**
     * Desde la alarma de supervisión: el pulso de 10 min corre en un Handler
     * que se congela con la CPU dormida (se veía un reporte cada ~33 min).
     */
    fun reportIfDue() {
        if (running) medirTemperaturaSiToca()
        if (running && System.currentTimeMillis() - ultimoReporteMs >= INTERVAL_MS) report()
    }

    // Último estado de las notificaciones que se informó al servidor.
    @Volatile
    private var notificacionesAvisadas: Boolean? = null

    /** Si las notificaciones cambiaron desde el último reporte, se informa ya. */
    fun avisarSiCambianNotificaciones(context: Context) {
        val previo = notificacionesAvisadas ?: return
        if (previo != AjustesPermisos.notificaciones(context)) reportNow()
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
        appContext = null
    }

    private const val KEY_CAMBIO_GPS = "gpsUltimoCambio"

    /** Cómo estaba el teléfono cuando cambió la ubicación (viaja en el diagnóstico). */
    fun anotarCambioGps(context: Context, pantallaEncendida: Boolean, bloqueado: Boolean, ahorro: Boolean) {
        PreferenceManager.getDefaultSharedPreferences(context).edit().putString(
            KEY_CAMBIO_GPS,
            JSONObject().put("en", System.currentTimeMillis()).put("pantalla", pantallaEncendida)
                .put("bloqueado", bloqueado).put("ahorro", ahorro).toString(),
        ).apply()
    }

    private fun report() {
        val context = appContext ?: return
        ultimoReporteMs = System.currentTimeMillis()
        // GPS apagado o permiso quitado con jornada: aviso (sin insistir).
        com.dmujeres.app.avisos.AvisoInmediato.revisar(context)
        medirTemperaturaSiToca()
        val lecturas = synchronized(temperaturas) { temperaturas.toList().also { temperaturas.clear() } }
        Thread {
            runCatching {
                val prefs = PreferenceManager.getDefaultSharedPreferences(context)
                val locationEnabled = runCatching {
                    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                    manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                }.getOrDefault(false)
                val pending = runCatching { DatabaseHelper(context).countPositions() }.getOrDefault(-1)
                // Identidad y salud de la cola: el servidor deriva el estado con causa.
                val bootId = runCatching { DatabaseHelper(context).currentBootId() }.getOrDefault("")
                val bufferOverflow = runCatching { DatabaseHelper(context).bufferOverflowCount() }.getOrDefault(0L)
                val deadEvents = runCatching { DatabaseHelper(context).deadEventsCount() }.getOrDefault(0L)
                val recoveryCount = prefs.getLong(Prefs.RECOVERY_COUNT, 0L)
                val movementState = prefs.getString(Prefs.MOVEMENT_STATE, "UNKNOWN").orEmpty()
                // Modo caminata: el panel distingue el paseo a pie (2-8 km/h,
                // cadencia fina por avance) del vehículo, sin tocar el lote.
                val walking = prefs.getBoolean(Prefs.MOVEMENT_WALKING, false)
                val movementMode = prefs.getString(Prefs.MOVEMENT_MODE, Prefs.MODE_NORMAL).orEmpty()
                val fgsState = if (TrackingService.isRunning) "running" else "stopped"
                val battery = readBatteryStatus(context)
                val fixAt = prefs.getLong(PositionProvider.KEY_LAST_FIX_AT, 0L)
                val fixAgeSec = if (fixAt > 0) (System.currentTimeMillis() - fixAt) / 1000 else -1
                val exempt = runCatching {
                    (context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                        .isIgnoringBatteryOptimizations(context.packageName)
                }.getOrDefault(false)
                val permFine = ContextCompat.checkSelfPermission(
                    context, android.Manifest.permission.ACCESS_FINE_LOCATION,
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                val permBackground = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                    ContextCompat.checkSelfPermission(
                        context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                // El permiso y el interruptor de Ajustes: apagadas, la persona
                // deja de ver los avisos de la app.
                val permNotifications = AjustesPermisos.notificaciones(context)
                notificacionesAvisadas = permNotifications
                DmujeresApi.postDiagnostics(
                    context,
                    JSONObject().put(
                        "report",
                        JSONObject()
                            .put(
                                "app",
                                JSONObject()
                                    .put("versionCode", BuildConfig.VERSION_CODE)
                                    .put("versionName", BuildConfig.VERSION_NAME),
                            )
                            .put(
                                "gps",
                                JSONObject()
                                    .put("enabled", locationEnabled)
                                    .put("provider", TrackingController.proveedorVigente)
                                    .put("vigilia", VigiliaGps.activa())
                                    .put("fixAgeSec", fixAgeSec)
                                    .put("mock", prefs.getBoolean(Prefs.LAST_MOCK, false))
                                    .put("cambio", prefs.getString(KEY_CAMBIO_GPS, null)?.let { runCatching { JSONObject(it) }.getOrNull() }),
                            )
                            // Si los avisos no llegan: cómo está el canal y qué pasó con el último.
                            .put(
                                "avisos",
                                runCatching { com.dmujeres.app.avisos.AvisosDelDia.estadoCanal(context) }.getOrDefault(JSONObject())
                                    .put("inmediato", prefs.getString(com.dmujeres.app.avisos.AvisoInmediato.KEY_DIAGNOSTICO, null)),
                            )
                            .put("buffer", JSONObject().put("pending", pending)
                                // Pendientes; overflow y dead explican huecos que
                                // ya no se van a llenar.
                                .put("depth", pending)
                                .put("overflow", bufferOverflow)
                                .put("dead", deadEvents))
                            // Batería y exención de ahorro: el panel muestra
                            // quién está restringido (una causa común de cortes).
                            .put(
                                "power",
                                JSONObject()
                                    .put("battery", battery.level.toInt().coerceIn(0, 100))
                                    .put("charging", battery.charging)
                                    .put("exempt", exempt)
                                    .put("tempC", battery.temperatureC)
                                    .put("tempVigente", battery.vigente)
                                    // Estado de calor del propio teléfono (Android 10+): 0 normal … 6 apagado por calor.
                                    .put(
                                        "termico",
                                        if (android.os.Build.VERSION.SDK_INT >= 29) runCatching {
                                            (context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).currentThermalStatus
                                        }.getOrNull() else null,
                                    )
                                    .put(
                                        "tempLecturas",
                                        org.json.JSONArray(lecturas.map { org.json.JSONArray().put(it.first).put(it.second) }),
                                    )
                                    .put("saver", EstadoTelefono.ahorroDeBateria(context)),
                            )
                            // Qué tiene el teléfono: conexión, memoria libre,
                            // servicios de Google y hora propia (el servidor la
                            // compara con la suya para ver relojes cambiados).
                            .put(
                                "device",
                                JSONObject()
                                    .put("net", EstadoTelefono.conexion(context))
                                    .put("memFreeMb", EstadoTelefono.memoriaLibreMb(context))
                                    .put("play", EstadoPlay.leer(context))
                                    .put("clockMs", System.currentTimeMillis()),
                            )
                            // Pasos de la jornada: comprueba que el teléfono va con una persona.
                            .put(
                                "activity",
                                JSONObject()
                                    .put("permission", AjustesPermisos.actividadFisica(context))
                                    .put("sensor", Pasos.disponible(context))
                                    .put("steps", Pasos.deLaJornada(context)),
                            )
                            // Cadencia efectiva: permite detectar desde el panel
                            // un equipo que traza con huecos.
                            .put(
                                "cadence",
                                JSONObject()
                                    .put("movingMs", AdaptiveCadence.movingIntervalMs(null))
                                    .put("stationaryMs", AdaptiveCadence.STATIONARY_INTERVAL_MS),
                            )
                            // Permisos que deciden si la captura aguanta en segundo plano.
                            .put(
                                "perms",
                                JSONObject()
                                    .put("fine", permFine)
                                    .put("background", permBackground)
                                    .put("notifications", permNotifications)
                                    .put("activity", AjustesPermisos.actividadFisica(context)),
                            )
                            .put(
                                "journey",
                                JSONObject().put(
                                    "active",
                                    prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false),
                                ),
                            )
                            // Identidad y continuidad: boot_id, recuperaciones,
                            // estado del servicio y de la máquina de movimiento.
                            .put("bootId", bootId)
                            .put("recoveryCount", recoveryCount)
                            .put("fgsState", fgsState)
                            .put("movementState", movementState)
                            .put("caminando", walking)
                            .put("mode", movementMode)
                            .put("serverUrl", prefs.getString(Prefs.URL, ""))
                            // Por qué se detiene la captura: pantalla, reposo,
                            // ahorro, cubeta de espera, alarmas exactas, tiempo
                            // encendido (reinicio real del teléfono o no) y la
                            // última salida de la app según el sistema.
                            .put("sistema", EstadoTelefono.sistema(context))
                            .put(
                                "envio",
                                JSONObject()
                                    .put("fallosSeguidos", UploadQueue.fallosSeguidos)
                                    .put("ultimoOkMs", UploadQueue.ultimoEnvioOkMs)
                                    .put("ultimoError", UploadQueue.ultimoError),
                            ),
                    ),
                )
            }
            // Si se concedió el permiso de pasos con el servicio ya encendido.
            TrackingService.reintentarPasos()
            // Configuración remota: cada 10 min, y solo reinicia si cambió.
            RemoteConfig.applyAndRestartIfChanged(context)
            // Actualización sin abrir la app: aviso en la barra (cada 6 h).
            runCatching { OtaNotifier.maybeCheck(context) }
            // Se reintentan los avisos de jornada que no llegaron.
            runCatching { DmujeresApi.flushJourneyEvents(context) }
            runCatching { PowerEvents.flush(context) }
            // Actividades del cronograma cargadas sin conexión.
            runCatching { com.dmujeres.app.cronograma.Actividades.sincronizar(context) }
        }.start()
    }
}

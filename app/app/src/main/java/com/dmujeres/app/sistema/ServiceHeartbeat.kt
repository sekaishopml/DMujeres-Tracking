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
import com.dmujeres.app.seguimiento.TrackingService
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

    fun start(context: Context) {
        if (running) return
        running = true
        appContext = context.applicationContext
        report()
        handler.postDelayed(tick, INTERVAL_MS)
        Log.i(TAG, "latido de diagnóstico iniciado")
    }

    /**
     * Diagnóstico inmediato, sin esperar los 10 minutos: cuando se apaga o se
     * enciende la ubicación, el panel lo sabe enseguida.
     */
    fun reportNow() {
        if (running) report()
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
        appContext = null
    }

    private fun report() {
        val context = appContext ?: return
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
                val permNotifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    ContextCompat.checkSelfPermission(
                        context, android.Manifest.permission.POST_NOTIFICATIONS,
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
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
                                    .put("provider", "fused")
                                    .put("fixAgeSec", fixAgeSec)
                                    .put("mock", prefs.getBoolean(Prefs.LAST_MOCK, false)),
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
                                    .put("exempt", exempt),
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
                                    .put("notifications", permNotifications),
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
                            .put("serverUrl", prefs.getString(Prefs.URL, "")),
                    ),
                )
            }
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

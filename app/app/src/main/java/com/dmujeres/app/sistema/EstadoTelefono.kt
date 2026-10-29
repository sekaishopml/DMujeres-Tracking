package com.dmujeres.app.sistema

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import com.dmujeres.app.recuperacion.DozeAlarmReceiver
import org.json.JSONObject

/** Datos del teléfono que explican cortes y se mandan en el diagnóstico. */
object EstadoTelefono {

    /** "wifi", "datos" (móviles) u "ninguna". */
    fun conexion(context: Context): String = runCatching {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capacidades = manager.getNetworkCapabilities(manager.activeNetwork)
        when {
            capacidades == null -> "ninguna"
            capacidades.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capacidades.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "datos"
            else -> "otra"
        }
    }.getOrDefault("desconocida")

    /**
     * Android comprobó que la red activa llega a internet (red validada). Una
     * red sin salida (wifi sin servicio, datos sin saldo) no lo está.
     */
    fun internetValidado(context: Context): Boolean = runCatching {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }.getOrDefault(false)

    /** Memoria libre en MB (-1 si no se pudo leer). */
    fun memoriaLibreMb(context: Context): Long = runCatching {
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        info.availMem / (1024 * 1024)
    }.getOrDefault(-1L)

    /** Modo "ahorro de batería" del sistema (apaga ubicación en segundo plano en varios teléfonos). */
    fun ahorroDeBateria(context: Context): Boolean = runCatching {
        (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode
    }.getOrDefault(false)

    /**
     * Lo que decide si el sistema deja trabajar a la app: pantalla, reposo
     * (Doze), ahorro, cubeta de espera (10 activa ... 45 restringida), alarmas
     * exactas, minutos encendido (si bajan, el teléfono se reinició) y la
     * última salida de la app según el sistema (Android 11+).
     */
    fun sistema(context: Context): JSONObject {
        val json = JSONObject()
        runCatching {
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            json.put("pantalla", power.isInteractive)
            json.put("ahorro", power.isPowerSaveMode)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) json.put("reposo", power.isDeviceIdleMode)
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val uso = context.getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager
                json.put("cubeta", uso.appStandbyBucket)
            }
        }
        json.put("alarmasExactas", runCatching { DozeAlarmReceiver.exactas(context) }.getOrDefault(false))
        json.put("encendidoMin", SystemClock.elapsedRealtime() / 60_000)
        json.put("fabricante", Build.MANUFACTURER.orEmpty())
        json.put("rom", Build.DISPLAY.orEmpty().take(60))
        OemAutostart.inicioAutomaticoXiaomi(context)?.let { json.put("inicioAutomatico", it) }
        OemAutostart.sinRestriccionXiaomi(context)?.let { json.put("sinRestriccionXiaomi", it) }
        json.put("segundoPlanoRestringido", AjustesPermisos.segundoPlanoRestringido(context))
        runCatching {
            // Con ahorro de batería, Android puede cortar la ubicación a las apps en segundo plano
            // (0 sin cambio, 1 sin GPS, 2 sin ubicación, 3 solo primer plano, 4 limitada).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                json.put("ubicacionEnAhorro", power.locationPowerSaveMode)
            }
        }
        json.put(
            "reiniciosPorAlarma",
            androidx.preference.PreferenceManager.getDefaultSharedPreferences(context)
                .getLong(DozeAlarmReceiver.KEY_REINICIOS, 0L),
        )
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                am.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()?.let { salida ->
                    json.put(
                        "ultimaSalida",
                        JSONObject()
                            .put("motivo", salida.reason)
                            .put("enMs", salida.timestamp)
                            .put("detalle", salida.description.orEmpty().take(120)),
                    )
                }
            }
        }
        return json
    }
}

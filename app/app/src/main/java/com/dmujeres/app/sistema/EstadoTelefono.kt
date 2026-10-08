package com.dmujeres.app.sistema

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.PowerManager

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
}

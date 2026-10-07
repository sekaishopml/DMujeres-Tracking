package com.dmujeres.app.datos

import com.dmujeres.app.R

/** Estado de la consulta de configuración remota. */
enum class ConfigState { OK, UPDATED, NA }

/**
 * Resumen del botón Actualizar. Solo dice lo que la persona puede arreglar
 * (datos, GPS, ahorro de batería) o, si está todo bien, que el servidor ya
 * tiene su ubicación. Lo interno (avisos, configuración) no se muestra.
 */
enum class RefreshSummary(val textRes: Int, val allGood: Boolean) {
    NO_NETWORK(R.string.refresh_summary_no_net, false),
    SERVER_DOWN(R.string.refresh_summary_server_off, false),
    GPS_OFF(R.string.refresh_summary_gps_off, false),
    BATTERY_SAVER(R.string.refresh_summary_battery_saver, false),
    PENDING_UNSENT(R.string.refresh_summary_pending, false),
    ALL_GOOD(R.string.refresh_summary_ok, true),
    ALL_GOOD_NO_JOURNEY(R.string.refresh_summary_sin_jornada, true),
}

/**
 * Resultado del botón Actualizar (sin Android, se prueba en la JVM). Orden:
 * sin red, servidor, GPS, ahorro de batería y pendientes. Sin jornada no se
 * exige GPS ni se esperan puntos: solo se sube lo que haya pendiente.
 */
data class RefreshOutcome(
    val journeyOpen: Boolean = true,
    val pendingBefore: Int = 0,
    val pendingAfter: Int = 0,
    val gpsOn: Boolean = true,
    val online: Boolean = true,
    val serverOk: Boolean = true,
    val batterySaver: Boolean = false,
) {
    /** Enviados en este refresco (nunca negativo). */
    val sent: Int get() = (pendingBefore - pendingAfter).coerceAtLeast(0)

    fun summary(): RefreshSummary = when {
        !online -> RefreshSummary.NO_NETWORK
        !serverOk -> RefreshSummary.SERVER_DOWN
        !journeyOpen -> RefreshSummary.ALL_GOOD_NO_JOURNEY
        !gpsOn -> RefreshSummary.GPS_OFF
        batterySaver -> RefreshSummary.BATTERY_SAVER
        pendingAfter > 0 -> RefreshSummary.PENDING_UNSENT
        else -> RefreshSummary.ALL_GOOD
    }
}

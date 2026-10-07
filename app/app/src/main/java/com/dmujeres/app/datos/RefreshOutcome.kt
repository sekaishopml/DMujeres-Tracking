package com.dmujeres.app.datos

import com.dmujeres.app.R

/** Estado del canal de avisos (FCM) visto por el refresco manual. */
enum class FirebaseState { OK, FAIL, NA }

/** Estado de la consulta de configuración remota. */
enum class ConfigState { OK, UPDATED, NA }

/**
 * Resumen del botón Actualizar. El texto está en strings.xml y se muestra en
 * el botón, en una línea.
 */
enum class RefreshSummary(val textRes: Int, val allGood: Boolean) {
    JOURNEY_CLOSED(R.string.refresh_summary_journey_closed, false),
    NO_NETWORK(R.string.refresh_summary_no_net, false),
    SERVER_DOWN(R.string.refresh_summary_server_off, false),
    GPS_OFF(R.string.refresh_summary_gps_off, false),
    PENDING_UNSENT(R.string.refresh_summary_pending, false),
    ALL_GOOD_WARNINGS(R.string.refresh_summary_all_good_warnings, true),
    ALL_GOOD_CONFIG(R.string.refresh_summary_all_good_config, true),
    ALL_GOOD(R.string.refresh_step_done, true),
}

/**
 * Resultado de cada paso del botón Actualizar (sin Android, se prueba en la
 * JVM).
 *
 * Orden del resumen: jornada cerrada, sin red, servidor, GPS, pendientes y
 * avisos. Un aviso (push sin token, configuración sin consultar) no es una
 * falla: si lo demás está bien, el resumen sigue siendo bueno.
 */
data class RefreshOutcome(
    val journeyOpen: Boolean = true,
    val pendingBefore: Int = 0,
    val pendingAfter: Int = 0,
    val gpsOn: Boolean = true,
    val online: Boolean = true,
    val serverOk: Boolean = true,
    val firebase: FirebaseState = FirebaseState.OK,
    val config: ConfigState = ConfigState.OK,
) {

    /** Enviados en este refresco (nunca negativo). */
    val sent: Int get() = (pendingBefore - pendingAfter).coerceAtLeast(0)

    fun summary(): RefreshSummary = when {
        !journeyOpen -> RefreshSummary.JOURNEY_CLOSED
        !online -> RefreshSummary.NO_NETWORK
        !serverOk -> RefreshSummary.SERVER_DOWN
        !gpsOn -> RefreshSummary.GPS_OFF
        pendingAfter > 0 -> RefreshSummary.PENDING_UNSENT
        firebase == FirebaseState.FAIL -> RefreshSummary.ALL_GOOD_WARNINGS
        config == ConfigState.NA -> RefreshSummary.ALL_GOOD_CONFIG
        else -> RefreshSummary.ALL_GOOD
    }
}

package com.dmujeres.app.captura

/**
 * Guarda los puntos de las esquinas (sin Android, se prueba en la JVM).
 *
 * Con un punto cada 10 s las esquinas se cortan (a 15 km/h son unos 40 m).
 * Si el rumbo cambia 30° o más respecto al último guardado, el punto se guarda
 * aunque esté detenida. Como mucho uno cada 3 s, para que una redondela no
 * dispare una ráfaga.
 *
 * Detenido el rumbo del GPS salta al azar, así que solo cuenta en movimiento
 * (2 nudos o más, unos 3,7 km/h). Trabaja junto con el detector de giros del
 * giroscopio, que pide el punto: este asegura que se guarde.
 */
object TurnCapture {

    /** Cambio de rumbo que marca esquina (grados). */
    const val ANGLE_DEG = 30.0

    /** Enfriamiento mínimo entre extras de giro (ms). */
    const val MIN_INTERVAL_MS = 3_000L

    /** Velocidad mínima para que el rumbo sea creíble (nudos, ≈3,7 km/h). */
    const val MIN_SPEED_KN = 2.0

    /**
     * ¿El punto marca un giro y hay que guardarlo?
     *
     * @param msSinceLastExtra tiempo desde el último punto extra por giro
     * ([Long.MAX_VALUE] si nunca hubo).
     */
    fun isTurn(
        lastCourseDeg: Double,
        candidateCourseDeg: Double,
        candidateSpeedKn: Double,
        msSinceLastExtra: Long,
        hasReference: Boolean,
    ): Boolean {
        if (!hasReference) return false
        if (msSinceLastExtra < MIN_INTERVAL_MS) return false
        if (candidateSpeedKn < MIN_SPEED_KN) return false
        return Geo.bearingDiffDeg(lastCourseDeg, candidateCourseDeg) >= ANGLE_DEG
    }
}

package com.dmujeres.app.captura

/**
 * Descarta saltos imposibles (sin Android, se prueba en la JVM).
 *
 * Rechaza el punto cuando exige una velocidad imposible desde el último punto
 * aceptado reciente (menos de 60 s). Sin referencia, o con una vieja, se
 * acepta: no hay con qué comparar.
 *
 * Dos reglas:
 * - T1: la velocidad calculada supera los 200 km/h.
 * - T2: el GPS dice velocidad 0 pero la posición saltó rápido (por ejemplo,
 *   70 m en 13 s: no llega a 200 km/h, pero estando quieta es imposible).
 *
 * Si el salto entra en el margen de error de los dos puntos (la precisión
 * nueva más la anterior) no es un salto: es mala señal y se acepta (los
 * demás filtros se encargan). Sin dato de precisión (el GPS del sistema no
 * lo da) se rechaza.
 */
object TeleportGuard {

    /** Velocidad implícita máxima creíble: 200 km/h en m/s. */
    const val MAX_SPEED_MPS = 55.56

    /** Solo se juzga contra referencia fresca (<60 s). */
    const val FRESH_WINDOW_MS = 60_000L

    /** Velocidad reportada que cuenta como "~0" (nudos, ≈1,85 km/h). */
    const val STILL_SPEED_KN = 1.0

    /**
     * Implícita mínima para la incoherencia en parado (km/h): muy por encima
     * de la caminata (2-8 km/h) y muy por debajo de 200 km/h. El salto real de
     * 70 m en 13 s (≈19,4 km/h con vel 0) cae aquí.
     */
    const val INCOHERENT_MIN_KMH = 15.0

    /** Último punto aceptado (pasó este filtro, se haya guardado o no). */
    data class Reference(
        val capturedAtMs: Long,
        val lat: Double,
        val lon: Double,
        val accuracyM: Double,
    )

    /** Fix candidato a juzgar. */
    data class Candidate(
        val capturedAtMs: Long,
        val lat: Double,
        val lon: Double,
        val accuracyM: Double,
        val speedKn: Double,
    )

    enum class Verdict { ACCEPT, REJECT }

    fun evaluate(candidate: Candidate, last: Reference?): Verdict {
        if (last == null) return Verdict.ACCEPT
        val dtMs = candidate.capturedAtMs - last.capturedAtMs
        // Sin orden de tiempo o con referencia vieja no se juzga: se acepta.
        if (dtMs <= 0L || dtMs > FRESH_WINDOW_MS) return Verdict.ACCEPT
        val distM = Geo.distanceM(last.lat, last.lon, candidate.lat, candidate.lon)
        if (distM <= 0.0) return Verdict.ACCEPT
        val impliedMps = distM / (dtMs / 1000.0)
        val absurd = impliedMps > MAX_SPEED_MPS
        val incoherent = !absurd &&
            candidate.speedKn < STILL_SPEED_KN &&
            impliedMps * 3.6 > INCOHERENT_MIN_KMH
        if (!absurd && !incoherent) return Verdict.ACCEPT
        // La precisión lo justifica: el salto cabe en el error combinado.
        if (candidate.accuracyM > 0.0 && last.accuracyM > 0.0 &&
            distM <= candidate.accuracyM + last.accuracyM
        ) {
            return Verdict.ACCEPT
        }
        return Verdict.REJECT
    }
}

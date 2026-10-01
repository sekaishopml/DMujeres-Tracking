package com.dmujeres.app.capture

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Cálculos geográficos para los filtros de captura (sin Android, para poder
 * probarlos en la JVM): distancia (haversine) y diferencia de rumbos. Solo
 * para decidir si se guarda un punto, nunca para inventar posiciones.
 */
object Geo {

    /** Radio terrestre medio (m). */
    const val EARTH_RADIUS_M = 6_371_000.0

    /** Metros por grado de latitud (aproximación para pasos cortos). */
    private const val METERS_PER_DEGREE_LAT = 111_320.0

    /** Distancia en metros entre dos coordenadas (haversine). */
    fun distanceM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }

    /**
     * Diferencia entre dos rumbos (0 a 180°), sin importar el paso por 0/360
     * (350° y 10° están a 20°, no a 340°).
     */
    fun bearingDiffDeg(aDeg: Double, bDeg: Double): Double {
        var diff = abs(aDeg - bDeg) % 360.0
        if (diff > 180.0) diff = 360.0 - diff
        return diff
    }

    /**
     * Desplaza un punto metros al norte/este (aproximación plana, válida para
     * pasos de decenas de metros). Se usa sobre todo en los tests para
     * construir derivas y caminatas deterministas.
     */
    fun offset(lat: Double, lon: Double, northM: Double, eastM: Double): Pair<Double, Double> {
        val dLat = northM / METERS_PER_DEGREE_LAT
        val dLon = eastM / (METERS_PER_DEGREE_LAT * cos(Math.toRadians(lat)).coerceAtLeast(0.2))
        return (lat + dLat) to (lon + dLon)
    }
}

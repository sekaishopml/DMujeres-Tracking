package com.dmujeres.app.captura

/**
 * Qué guardar estando quieta (sin Android, se prueba en la JVM).
 *
 * Detenido, el GPS tiembla (±25 m) y se guardaba cada punto. Estando quieta
 * solo se guarda si avanzó de verdad desde el último guardado (15 m o más) o
 * si pasaron 5 min (para saber que sigue ahí). Así el temblor no se guarda y
 * una salida real sí.
 *
 * Se aplica en STATIONARY, o con velocidad cero sostenida aunque la máquina
 * siga en ACTIVE (un semáforo de 2 min). Un 0 suelto no cuenta: la quietud
 * tiene que durar 60 s.
 *
 * Bajo techo el error es mayor que 15 m (25 a 80 m): el punto "camina" con
 * la persona sentada. Por eso el avance tiene que superar también el doble
 * del error de las lecturas, con un tope de 100 m para que una salida real
 * con mala señal no se pierda.
 *
 * Nunca inventa ni mueve puntos: solo decide si se guarda el punto tal cual.
 */
object StationaryCollapse {

    /** Avance real desde el último almacenado que siempre se guarda (m). */
    const val MIN_DISTANCE_M = 15.0

    /** Tope del avance exigido por mala precisión (m). */
    const val MAX_DISTANCE_M = 100.0

    /** Avance que cuenta como real con este error: el doble del peor de los dos puntos. */
    fun avanceMinimo(accuracyM: Double, storedAccuracyM: Double): Double =
        (2 * maxOf(accuracyM, storedAccuracyM)).coerceIn(MIN_DISTANCE_M, MAX_DISTANCE_M)

    /**
     * ¿Se movió de verdad? Una lectura de más de 100 m de error (antenas, bajo
     * techo) nunca cuenta como avance: saltaba 300 m con la persona quieta.
     */
    fun avanzo(distM: Double, accuracyM: Double, storedAccuracyM: Double): Boolean =
        accuracyM <= MAX_DISTANCE_M && distM >= avanceMinimo(accuracyM, storedAccuracyM)

    /** Estando quieta, un punto cada 5 min aunque no se mueva. */
    const val HEARTBEAT_MS = 5 * 60_000L

    /** Velocidad reportada que cuenta como "~0" (nudos, ≈1,85 km/h). */
    const val STILL_SPEED_KN = 1.0

    /** Cuánto debe sostenerse el ~0 en ACTIVE para colapsar (ms). */
    const val STILL_SUSTAINED_MS = 60_000L

    /**
     * ¿Se guarda el punto?
     *
     * @param stationary la máquina ya está en STATIONARY.
     * @param stillSustained velocidad cero sostenida (la calcula [CaptureGate]).
     * @param speedKn velocidad del punto.
     * @param distFromStoredM distancia desde el último guardado.
     * @param msSinceStored tiempo desde el último guardado.
     * @param hasReference false en el primer punto (sin referencia se guarda).
     */
    fun shouldStore(
        stationary: Boolean,
        stillSustained: Boolean,
        speedKn: Double,
        distFromStoredM: Double,
        msSinceStored: Long,
        hasReference: Boolean,
        accuracyM: Double = 0.0,
        storedAccuracyM: Double = 0.0,
    ): Boolean {
        if (!hasReference) return true
        val quiet = stationary || (stillSustained && speedKn < STILL_SPEED_KN)
        if (!quiet) return true
        if (avanzo(distFromStoredM, accuracyM, storedAccuracyM)) return true
        if (msSinceStored >= HEARTBEAT_MS) return true
        return false
    }
}

package com.dmujeres.app.captura

import com.dmujeres.app.datos.Ajustes

/**
 * Qué guardar estando quieta (sin Android, se prueba en la JVM).
 *
 * Detenido, el GPS tiembla (±25 m) y se guardaba cada punto. Estando quieta
 * solo se guarda si avanzó de verdad desde el último guardado (15 m o más) o
 * si pasó el latido (para saber que sigue ahí, ver [latidoMs]). Así el
 * temblor no se guarda y una salida real sí.
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

    /** Error (m) hasta el que una lectura ubica bien el sitio. */
    const val PRECISION_BUENA_M = 50.0

    /**
     * Cada cuánto se guarda un punto estando quieta (los tiempos llegan del
     * servidor, ver [Ajustes]): seguido (2 min) al llegar a un sitio, porque
     * la persona puede irse pronto y la parada tiene que verse entera, y
     * cuando el último guardado fue malo y ahora hay una lectura buena, para
     * que el sitio quede bien ubicado. El resto del tiempo, 5 min.
     *
     * @param quietaMs tiempo que lleva quieta en este sitio.
     * @param guardadoAccuracyM error del último punto guardado.
     */
    fun latidoMs(quietaMs: Long, accuracyM: Double, guardadoAccuracyM: Double): Long {
        val normal = Ajustes.valor(Ajustes.Clave.LATIDO_QUIETA_MS)
        val corto = minOf(Ajustes.valor(Ajustes.Clave.LATIDO_CORTO_MS), normal)
        if (quietaMs < Ajustes.valor(Ajustes.Clave.LATIDO_CORTO_INICIO_MS)) return corto
        if (guardadoAccuracyM > PRECISION_BUENA_M && accuracyM in 0.0..PRECISION_BUENA_M) return corto
        return normal
    }

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
        latidoMs: Long = Ajustes.valor(Ajustes.Clave.LATIDO_QUIETA_MS),
    ): Boolean {
        if (!hasReference) return true
        val quiet = stationary || (stillSustained && speedKn < STILL_SPEED_KN)
        if (!quiet) return true
        if (avanzo(distFromStoredM, accuracyM, storedAccuracyM)) return true
        if (msSinceStored >= latidoMs) return true
        return false
    }
}

package com.dmujeres.app

/**
 * Movimiento según la velocidad real, por si el sensor no lo nota.
 *
 * Con el teléfono en un soporte blando el acelerómetro puede seguir diciendo
 * "quieto" y la captura quedaba cada 120 s con el vehículo andando. Si el GPS
 * o la distancia entre puntos dicen que se mueve, se captura seguido aunque
 * el sensor no lo note.
 */
object MotionSignal {

    /** Velocidad (nudos) desde la que se considera movimiento real. */
    const val MOVING_SPEED_KN = 3.0

    /**
     * ¿La velocidad justifica tratar el equipo como en movimiento?
     * [speedKn] es la velocidad reportada por el GPS y [impliedKn] la derivada
     * de la distancia/tiempo entre los dos últimos fixes aceptados.
     */
    fun shouldMove(speedKn: Double, impliedKn: Double): Boolean =
        maxOf(speedKn, impliedKn) >= MOVING_SPEED_KN
}

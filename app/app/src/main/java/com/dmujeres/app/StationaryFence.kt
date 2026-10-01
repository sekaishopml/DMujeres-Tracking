package com.dmujeres.app

/**
 * Cerca de quietud: avisa que el teléfono se movió sin depender del
 * acelerómetro.
 *
 * Estando quieta se pide ubicación cada 120 s, y en teléfonos con ahorro de
 * energía agresivo (Infinix o Tecno) los sensores dejan de avisar con la
 * pantalla apagada: había días de 5 a 18 km con un punto cada 15 min. La
 * geocerca la vigila Google Play Services, fuera de la app, y avisa al salir
 * del radio aunque los sensores estén dormidos.
 *
 * El controlador la arma al pasar a STATIONARY (centro = último punto) y la
 * quita al volver a moverse. La versión sin Play Services no la tiene.
 */
interface StationaryFence {
    fun arm(latitude: Double, longitude: Double)
    fun disarm()

    companion object {
        /** Radio de la cerca: por encima del ruido de un fix BALANCED urbano. */
        const val RADIUS_M = 150f
    }
}

/** Sin Play Services no hay geocercas; queda la alarma de rescate. */
object NoStationaryFence : StationaryFence {
    override fun arm(latitude: Double, longitude: Double) = Unit
    override fun disarm() = Unit
}

package com.dmujeres.app

/**
 * Si los envíos están funcionando (sin consultar la base). Lo actualiza
 * [TrackingController] en cada intento y la pantalla principal lo usa para
 * mostrar "SIN CONEXIÓN" (hay internet pero el servidor no recibe).
 */
object ConnectionState {

    @Volatile
    private var lastSuccessAt = 0L

    @Volatile
    private var lastFailureAt = 0L

    fun noteSuccess(nowMs: Long) {
        lastSuccessAt = nowMs
    }

    fun noteFailure(nowMs: Long) {
        lastFailureAt = nowMs
    }

    /** true si el último intento falló y no hubo uno exitoso después. */
    fun isFailing(): Boolean = lastFailureAt > lastSuccessAt
}

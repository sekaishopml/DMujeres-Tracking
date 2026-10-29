package com.dmujeres.app.red

import com.dmujeres.app.seguimiento.TrackingController

/**
 * Si los envíos están funcionando (sin consultar la base). Lo actualizan
 * [TrackingController] y la cola en cada intento; la pantalla principal lo usa
 * para decir "Sin internet" o "Servidor no responde" (ver [EstadoEnvio]).
 */
object ConnectionState {

    @Volatile
    private var lastSuccessAt = 0L

    @Volatile
    private var lastFailureAt = 0L

    /** Intentos fallidos seguidos desde el último que salió bien. */
    @Volatile
    private var fallidosSeguidos = 0

    fun noteSuccess(nowMs: Long) {
        lastSuccessAt = nowMs
        fallidosSeguidos = 0
    }

    fun noteFailure(nowMs: Long) {
        lastFailureAt = nowMs
        fallidosSeguidos++
    }

    /** true si el último intento falló y no hubo uno exitoso después. */
    fun isFailing(): Boolean = lastFailureAt > lastSuccessAt

    fun estado(redActiva: Boolean, internetValidado: Boolean): EstadoEnvio =
        EstadoEnvio.de(isFailing(), fallidosSeguidos, redActiva, internetValidado)
}

/**
 * Qué decir cuando no se puede enviar (sin Android, se prueba en la JVM).
 * "Servidor no responde" solo si Android comprobó que el teléfono tiene
 * internet (red validada) y aun así fallaron [MIN_FALLOS_SERVIDOR] envíos
 * seguidos: no sirve de excusa para un teléfono sin datos.
 */
enum class EstadoEnvio {
    EN_LINEA, SIN_INTERNET, SERVIDOR_NO_RESPONDE;

    companion object {
        const val MIN_FALLOS_SERVIDOR = 2

        fun de(fallando: Boolean, fallidosSeguidos: Int, redActiva: Boolean, internetValidado: Boolean): EstadoEnvio = when {
            !redActiva || !internetValidado -> if (fallando) SIN_INTERNET else EN_LINEA
            fallando && fallidosSeguidos >= MIN_FALLOS_SERVIDOR -> SERVIDOR_NO_RESPONDE
            else -> EN_LINEA
        }
    }
}

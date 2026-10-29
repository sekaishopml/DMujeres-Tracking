package com.dmujeres.app.seguimiento

/**
 * Arranque por el acelerómetro propio (sin Android, se prueba en la JVM).
 *
 * En los teléfonos sin reconocimiento de actividad de Google (Huawei sin
 * Google, algunos ZTE) solo el GPS notaba la salida, tarde. Si el
 * acelerómetro marca movimiento seguido [sostenidoMs], avisa el arranque igual
 * que "en vehículo / a pie". Un movimiento corto (sacar el teléfono del
 * bolsillo) no alcanza, y después de avisar espera [esperaMs] para no avisar
 * a cada rato.
 */
class ArranqueSostenido(
    private val sostenidoMs: Long = 20_000L,
    private val esperaMs: Long = 120_000L,
) {
    private var desde = -1L
    private var ultimoAviso = Long.MIN_VALUE / 2

    /** Cada lectura del acelerómetro: true cuando toca avisar el arranque. */
    fun muestra(ahoraMs: Long, moviendo: Boolean): Boolean {
        if (!moviendo) {
            desde = -1L
            return false
        }
        if (desde < 0L) desde = ahoraMs
        if (ahoraMs - desde < sostenidoMs || ahoraMs - ultimoAviso < esperaMs) return false
        ultimoAviso = ahoraMs
        return true
    }

    fun reiniciar() {
        desde = -1L
        ultimoAviso = Long.MIN_VALUE / 2
    }
}

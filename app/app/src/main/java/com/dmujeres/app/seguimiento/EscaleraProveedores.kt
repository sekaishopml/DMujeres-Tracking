package com.dmujeres.app.seguimiento

/**
 * Escalera de proveedores de ubicación (pura, testeable en JVM).
 *
 * Cuando el proveedor vigente deja de entregar posiciones, se pasa al
 * siguiente y, al final, se vuelve al primero: Google (fusionado), GPS del
 * teléfono (solo satélites: no responde bajo techo) y red (WiFi y antenas: menos
 * precisa, pero responde bajo techo). Cada posición guarda su precisión real.
 *
 * Bajar de escalón es un recurso temporal: pasado [VOLVER_ARRIBA_MS] se vuelve
 * al primero para recuperar la precisión.
 */
object EscaleraProveedores {

    enum class Escalon { GOOGLE, GPS, RED }

    /** Tiempo en un escalón de respaldo antes de volver a intentar el primero. */
    const val VOLVER_ARRIBA_MS = 10 * 60_000L

    fun primero(conGoogle: Boolean): Escalon = if (conGoogle) Escalon.GOOGLE else Escalon.GPS

    fun siguiente(actual: Escalon, conGoogle: Boolean): Escalon = when (actual) {
        Escalon.GOOGLE -> Escalon.GPS
        Escalon.GPS -> Escalon.RED
        Escalon.RED -> primero(conGoogle)
    }

    /** ¿Toca volver al primer escalón? Solo si hay posiciones (no en plena falla). */
    fun volverArriba(actual: Escalon, conGoogle: Boolean, desdeMs: Long, nowMs: Long, sinFix: Boolean): Boolean =
        actual != primero(conGoogle) && !sinFix && nowMs - desdeMs >= VOLVER_ARRIBA_MS
}

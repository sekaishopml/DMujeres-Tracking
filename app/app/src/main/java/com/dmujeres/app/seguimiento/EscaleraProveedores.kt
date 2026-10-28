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

    /**
     * En marcha no se baja a red: da puntos de 50 a 200 m cada 20 s que
     * dibujan un zigzag y no dicen por qué calle fue (Jeremy, 2.10.1). Se
     * alterna entre Google y el GPS hasta que alguno vuelva.
     */
    fun siguiente(actual: Escalon, conGoogle: Boolean, enMarcha: Boolean = false): Escalon = when (actual) {
        Escalon.GOOGLE -> Escalon.GPS
        Escalon.GPS -> if (enMarcha) primero(conGoogle) else Escalon.RED
        Escalon.RED -> primero(conGoogle)
    }

    /** ¿Toca volver al primer escalón? Solo si hay posiciones (no en plena falla). */
    fun volverArriba(actual: Escalon, conGoogle: Boolean, desdeMs: Long, nowMs: Long, sinFix: Boolean): Boolean =
        actual != primero(conGoogle) && !sinFix && nowMs - desdeMs >= VOLVER_ARRIBA_MS
}

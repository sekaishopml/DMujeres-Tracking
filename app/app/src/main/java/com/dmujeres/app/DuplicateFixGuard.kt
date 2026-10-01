package com.dmujeres.app

/**
 * Evita guardar dos veces el mismo punto (rápido, sin consultas).
 *
 * El GPS de Google a veces entrega la misma observación dos veces (misma hora
 * al milisegundo y mismas coordenadas) y se guardaba dos veces. El servidor
 * no lo detecta porque cada fila recibe su propia identidad (boot_id,
 * secuencia) al guardarse.
 *
 * Pasa porque [GooglePositionProvider] entrega por dos caminos (el periódico
 * y `getCurrentLocation` en `requestSingleLocation` / `requestFreshLocation`)
 * y [TrackingController] además pide puntos sueltos (al cambiar de frecuencia,
 * en un giro, con Actualizar o en un rescate). Si el suelto coincide con el
 * periódico, llega dos veces.
 *
 * Se compara contra el ÚLTIMO punto guardado, en memoria. Solo si la memoria
 * está vacía (arranque a medias) se lee una fila de la base.
 *
 * No cambia la frecuencia, el protocolo, la jornada ni la recuperación: solo
 * evita el duplicado.
 */
object DuplicateFixGuard {

    /**
     * Ventana de duplicado (ms): el mismo lugar con menos de 5 s no es la
     * frecuencia normal (10 s en movimiento, 120 s quieta), es el mismo punto
     * entregado dos veces.
     */
    const val DUPLICATE_WINDOW_MS = 5_000L

    /** Último fix almacenado: captured_at en ms + coordenadas exactas. */
    data class Fix(
        val capturedAtMs: Long,
        val latitude: Double,
        val longitude: Double,
    )

    /**
     * ¿[candidate] es el mismo punto que [last], ya guardado?
     *
     * Regla 1: misma hora (ms) y mismas coordenadas: es el mismo punto,
     * aunque llegue mucho después.
     *
     * Regla 2: mismas coordenadas con menos de 5 s de diferencia: es la misma
     * entrega por dos caminos (con una hora apenas distinta). Un punto válido
     * en el mismo lugar llega cada 10 s o más.
     */
    fun isDuplicate(candidate: Fix, last: Fix): Boolean {
        if (candidate.latitude != last.latitude || candidate.longitude != last.longitude) {
            return false
        }
        if (candidate.capturedAtMs == last.capturedAtMs) {
            return true
        }
        val dt = candidate.capturedAtMs - last.capturedAtMs
        return dt >= 0L && dt < DUPLICATE_WINDOW_MS
    }
}

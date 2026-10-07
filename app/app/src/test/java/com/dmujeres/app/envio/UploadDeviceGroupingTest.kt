package com.dmujeres.app.envio

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Agrupamiento de la cola por equipo de captura (puro JVM).
 *
 * El servidor dedupea por (equipo, tiempo, boot, secuencia): un lote jamás
 * puede mezclar equipos ni enviarse con el identificador actual si la fila se
 * capturó con otro, o la misma captura termina guardada bajo dos equipos
 * (si no, la misma ruta quedaba en dos equipos).
 */
class UploadDeviceGroupingTest {

    private data class Fila(val id: Long, val equipo: String)

    @Test
    fun `filas de dos equipos en cola se parten en dos envios con su identificador`() {
        val cola = listOf(
            Fila(1, "equipo-a"),
            Fila(2, "equipo-a"),
            Fila(3, "equipo-b"),
        )
        val grupos = UploadPolicy.groupByCaptureDevice(cola, "equipo-b") { it.equipo }
        assertEquals(2, grupos.size)
        // Primer grupo = fila más vieja; se envía con SU equipo, no con el actual.
        assertEquals("equipo-a", grupos[0].deviceId)
        assertEquals(listOf(1L, 2L), grupos[0].items.map { it.id })
        assertEquals("equipo-b", grupos[1].deviceId)
        assertEquals(listOf(3L), grupos[1].items.map { it.id })
    }

    @Test
    fun `fila sin device_id usa el identificador actual`() {
        val cola = listOf(
            Fila(1, ""),
            Fila(2, "  EQUIPO-A "),
        )
        val grupos = UploadPolicy.groupByCaptureDevice(cola, "Equipo-B") { it.equipo }
        assertEquals(2, grupos.size)
        assertEquals("equipo-b", grupos[0].deviceId)
        assertEquals(listOf(1L), grupos[0].items.map { it.id })
        // El equipo de captura se normaliza: misma fila, un solo grupo.
        assertEquals("equipo-a", grupos[1].deviceId)
        assertEquals(listOf(2L), grupos[1].items.map { it.id })
    }

    @Test
    fun `el grupo mas viejo va primero y el orden interno de la cola se conserva`() {
        val cola = listOf(
            Fila(1, "b"),
            Fila(2, "a"),
            Fila(3, "b"),
        )
        val grupos = UploadPolicy.groupByCaptureDevice(cola, "actual") { it.equipo }
        assertEquals(listOf("b", "a"), grupos.map { it.deviceId })
        assertEquals(listOf(1L, 3L), grupos[0].items.map { it.id })
        assertEquals(listOf(2L), grupos[1].items.map { it.id })
    }

    @Test
    fun `sin equipo de captura ni actual queda un solo grupo sin identificador`() {
        val cola = listOf(Fila(1, ""), Fila(2, ""))
        val grupos = UploadPolicy.groupByCaptureDevice(cola, "") { it.equipo }
        assertEquals(1, grupos.size)
        assertEquals("", grupos[0].deviceId)
        assertEquals(listOf(1L, 2L), grupos[0].items.map { it.id })
    }
}

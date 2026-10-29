package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Test

class ArranqueSostenidoTest {

    /** Lecturas cada 200 ms durante [ms]; devuelve cuántas veces avisó. */
    private fun avisos(a: ArranqueSostenido, desde: Long, ms: Long, moviendo: Boolean): Int =
        (0 until ms step 200).count { a.muestra(desde + it, moviendo) }

    @Test
    fun unMovimientoCortoNoAvisa() {
        val a = ArranqueSostenido()
        assertEquals(0, avisos(a, 0, 10_000, true))
        assertEquals(0, avisos(a, 10_000, 1_000, false))
        assertEquals(0, avisos(a, 11_000, 15_000, true))
    }

    @Test
    fun veinteSegundosSeguidosAvisaUnaVezYEspera() {
        val a = ArranqueSostenido()
        assertEquals(1, avisos(a, 0, 60_000, true))
        // Sigue moviéndose: no repite hasta pasados 2 min del aviso.
        assertEquals(0, avisos(a, 60_000, 50_000, true))
        assertEquals(1, avisos(a, 110_000, 40_000, true))
    }
}

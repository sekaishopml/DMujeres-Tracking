package com.dmujeres.app.cronograma

import org.junit.Assert.assertEquals
import org.junit.Test

class BuscadorLugaresTest {

    private val usados = listOf("Supermaxi El Bosque", "Mall del Sur", "Farmacia Cruz Azul", "Mall del Sol", "Comisariato Sur")

    @Test
    fun sinEscribirSalenLosMasUsados() {
        assertEquals(usados.take(2), BuscadorLugares.ordenar(usados, " ", 2))
    }

    @Test
    fun primeroLosQueEmpiezanConLaPrimeraPalabra() {
        assertEquals(listOf("Mall del Sur", "Comisariato Sur"), BuscadorLugares.ordenar(usados, "Sur"))
        assertEquals(listOf("Mall del Sur", "Mall del Sol"), BuscadorLugares.ordenar(usados, "mal"))
        assertEquals(listOf("Supermaxi El Bosque", "Mall del Sur", "Comisariato Sur"), BuscadorLugares.ordenar(usados, "su"))
    }

    @Test
    fun lasDemasPalabrasAfinanYSinTildes() {
        assertEquals(listOf("Mall del Sol"), BuscadorLugares.ordenar(usados, "MALL so"))
        assertEquals(listOf("Farmacia Cruz Azul"), BuscadorLugares.ordenar(usados, "farmácia az"))
    }

    @Test
    fun loYaEscritoCompletoNoSePropone() {
        assertEquals(emptyList<String>(), BuscadorLugares.ordenar(usados, "mall del sol"))
        assertEquals(emptyList<String>(), BuscadorLugares.ordenar(usados, "xyz"))
    }
}

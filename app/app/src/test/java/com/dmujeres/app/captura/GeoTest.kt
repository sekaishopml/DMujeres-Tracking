package com.dmujeres.app.captura

import org.junit.Assert.assertEquals
import org.junit.Test

/** Geodesia mínima de los filtros (JVM, sin dispositivo). */
class GeoTest {

    @Test
    fun `milésima de grado de latitud son unos 111 m`() {
        assertEquals(111.19, Geo.distanceM(-0.1807, -78.4678, -0.1797, -78.4678), 0.5)
    }

    @Test
    fun `distancia cero al mismo punto`() {
        assertEquals(0.0, Geo.distanceM(-0.1807, -78.4678, -0.1807, -78.4678), 0.0)
    }

    @Test
    fun `diferencia de rumbos insensible al cruce 0-360`() {
        assertEquals(20.0, Geo.bearingDiffDeg(350.0, 10.0), 1e-9)
        assertEquals(20.0, Geo.bearingDiffDeg(10.0, 350.0), 1e-9)
        assertEquals(180.0, Geo.bearingDiffDeg(0.0, 180.0), 1e-9)
        assertEquals(90.0, Geo.bearingDiffDeg(90.0, 0.0), 1e-9)
        assertEquals(30.0, Geo.bearingDiffDeg(350.0, 20.0), 1e-9)
    }

    @Test
    fun `offset de 70 m al norte mide 70 m`() {
        val (lat, lon) = Geo.offset(-0.1807, -78.4678, 70.0, 0.0)
        assertEquals(70.0, Geo.distanceM(-0.1807, -78.4678, lat, lon), 0.5)
    }
}

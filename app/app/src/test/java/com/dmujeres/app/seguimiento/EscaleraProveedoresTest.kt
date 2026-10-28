package com.dmujeres.app.seguimiento

import com.dmujeres.app.seguimiento.EscaleraProveedores.Escalon
import com.dmujeres.app.sistema.VigiliaGps
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EscaleraProveedoresTest {

    @Test
    fun `con Google recorre los tres y vuelve al primero`() {
        var e = EscaleraProveedores.primero(conGoogle = true)
        assertEquals(Escalon.GOOGLE, e)
        e = EscaleraProveedores.siguiente(e, true); assertEquals(Escalon.GPS, e)
        e = EscaleraProveedores.siguiente(e, true); assertEquals(Escalon.RED, e)
        e = EscaleraProveedores.siguiente(e, true); assertEquals(Escalon.GOOGLE, e)
    }

    @Test
    fun `sin Google alterna GPS y red`() {
        assertEquals(Escalon.GPS, EscaleraProveedores.primero(conGoogle = false))
        assertEquals(Escalon.RED, EscaleraProveedores.siguiente(Escalon.GPS, false))
        assertEquals(Escalon.GPS, EscaleraProveedores.siguiente(Escalon.RED, false))
    }

    @Test
    fun `vuelve arriba solo pasado el plazo y con posiciones`() {
        val plazo = EscaleraProveedores.VOLVER_ARRIBA_MS
        assertFalse(EscaleraProveedores.volverArriba(Escalon.RED, true, 0L, plazo - 1, sinFix = false))
        assertTrue(EscaleraProveedores.volverArriba(Escalon.RED, true, 0L, plazo, sinFix = false))
        assertFalse(EscaleraProveedores.volverArriba(Escalon.RED, true, 0L, plazo, sinFix = true))
        assertFalse(EscaleraProveedores.volverArriba(Escalon.GOOGLE, true, 0L, plazo * 3, sinFix = false))
    }

    @Test
    fun `etiqueta del bloqueo segun fabricante`() {
        assertEquals("LocationManagerService", VigiliaGps.etiqueta("HUAWEI"))
        assertEquals("LocationManagerService", VigiliaGps.etiqueta("Honor"))
        assertEquals("dmujeres:gps", VigiliaGps.etiqueta("Xiaomi"))
    }
}

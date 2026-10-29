package com.dmujeres.app.red

import org.junit.Assert.assertEquals
import org.junit.Test

class EstadoEnvioTest {

    @Test
    fun `sin internet comprobado nunca culpa al servidor`() {
        assertEquals(EstadoEnvio.SIN_INTERNET, EstadoEnvio.de(true, 5, redActiva = true, internetValidado = false))
        assertEquals(EstadoEnvio.SIN_INTERNET, EstadoEnvio.de(true, 5, redActiva = false, internetValidado = false))
    }

    @Test
    fun `con internet y dos fallos seguidos el servidor no responde`() {
        // Santi ZTE, 27/10: wifi con internet y el servidor no se alcanzaba.
        assertEquals(EstadoEnvio.SERVIDOR_NO_RESPONDE, EstadoEnvio.de(true, 2, redActiva = true, internetValidado = true))
        // Un fallo suelto no alcanza.
        assertEquals(EstadoEnvio.EN_LINEA, EstadoEnvio.de(true, 1, redActiva = true, internetValidado = true))
    }

    @Test
    fun `si el ultimo envio salio bien esta en linea`() {
        assertEquals(EstadoEnvio.EN_LINEA, EstadoEnvio.de(false, 0, redActiva = true, internetValidado = true))
    }
}

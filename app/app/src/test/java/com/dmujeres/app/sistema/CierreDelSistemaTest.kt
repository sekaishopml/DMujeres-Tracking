package com.dmujeres.app.sistema

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CierreDelSistemaTest {

    private val inicio = 1_000_000L
    private val cierre = inicio + 3_600_000L
    private val min = 60_000L

    private fun avisa(motivo: Int, detalle: String = "", vuelta: Long = cierre + 10 * min, atendido: Long = 0L, desde: Long = inicio) =
        CierreDelSistema.debeAvisar(motivo, detalle, cierre, desde, vuelta, atendido)

    @Test
    fun `avisa cuando el teléfono la cerró y tardó en volver`() {
        // Joselyn 04/11: Honor la detuvo y volvió horas después.
        assertTrue(avisa(10, "[FORCE STOP] stop com.dmujeres.tracking due to from pid 2189 iAwareR[PowerGenie smartopt clean] -1ms", vuelta = cierre + 300 * min))
        // Nadia 30/10: iAware la cerró y volvió a los 5 min.
        assertTrue(avisa(2, "iAwareR[LowMemQuick](fg-service) -1ms", vuelta = cierre + 5 * min))
    }

    @Test
    fun `no avisa si volvió sola enseguida`() {
        // Ariel 05/11: Xiaomi la limpió y volvió en segundos; Sofía 04/11: la alarma la levantó a los 2 min.
        assertFalse(avisa(13, "OneKeyClean", vuelta = cierre + 5_000L))
        assertFalse(avisa(13, "[KILL UID] Foreground kill", vuelta = cierre + 2 * min))
    }

    @Test
    fun `no avisa actualizaciones, cierres propios ni cierres fuera de la jornada`() {
        assertFalse(avisa(16, "stop com.dmujeres.tracking due to installPackageLI"))
        assertFalse(avisa(10, "stop com.dmujeres.tracking due to installPackageLI"))
        assertFalse(avisa(4))
        assertFalse(avisa(8, "permissions revoked"))
        assertFalse(avisa(13, "too many empty", desde = cierre + min))
    }

    @Test
    fun `una vez atendido no se repite hasta otro cierre`() {
        assertFalse(avisa(2, atendido = cierre))
        assertTrue(avisa(2, atendido = cierre - 1))
    }
}

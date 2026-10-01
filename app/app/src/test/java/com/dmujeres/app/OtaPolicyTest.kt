package com.dmujeres.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decisión del banner: mayor/menor/igual, reintento tras error y ausencia de
 * estado "visto". Sin Android ni red.
 */
class OtaPolicyTest {

    @Test
    fun `mayor publica avisa, igual o menor no`() {
        assertTrue(OtaPolicy.isUpdateAvailable(290, 289))
        assertFalse(OtaPolicy.isUpdateAvailable(290, 290))
        assertFalse(OtaPolicy.isUpdateAvailable(289, 290))
        assertFalse(OtaPolicy.isUpdateAvailable(0, 290))
    }

    @Test
    fun `nombre mayor avisa, igual o menor no (sin downgrade)`() {
        assertTrue(OtaPolicy.isNewerName("2.1.79", "2.1.80"))
        assertFalse(OtaPolicy.isNewerName("2.1.80", "2.1.80"))
        assertFalse(OtaPolicy.isNewerName("2.1.80", "2.1.79"))
        assertTrue(OtaPolicy.isNewerName("2.1.9", "2.1.10"))
        // Un sufijo no numérico nunca gana a la release instalada.
        assertFalse(OtaPolicy.isNewerName("2.1.80", "2.1.80-beta"))
    }

    @Test
    fun `apertura en frio consulta siempre aunque el freno este reciente`() {
        val now = 1_000_000L
        // Cerró/abrió 10 s después del último chequeo: antes se saltaba el
        // chequeo y el banner (vista nueva, oculto por defecto) no reaparecía.
        assertTrue(OtaPolicy.shouldCheck(now, now - 10_000L, coldStart = true))
    }

    @Test
    fun `con la app abierta se respeta el freno de un minuto`() {
        val now = 1_000_000L
        assertFalse(OtaPolicy.shouldCheck(now, now - 10_000L, coldStart = false))
        assertTrue(OtaPolicy.shouldCheck(now, now - 60_000L, coldStart = false))
        assertTrue(OtaPolicy.shouldCheck(now, now - 61_000L, coldStart = false))
    }

    @Test
    fun `sin sello previo o reloj atrasado se consulta (no quedar a ciegas)`() {
        val now = 1_000_000L
        assertTrue(OtaPolicy.shouldCheck(now, 0L, coldStart = false))
        assertTrue(OtaPolicy.shouldCheck(now, now + 5_000L, coldStart = false))
    }

    @Test
    fun `tras abrir nunca se bloquea mas de dos minutos`() {
        val now = 1_000_000L
        assertTrue(OtaPolicy.shouldCheck(now, now - 120_000L, coldStart = false))
        assertTrue(OtaPolicy.shouldCheck(now, now - 300_000L, coldStart = false))
    }

    @Test
    fun `ante error se reintenta en el siguiente ciclo (sin visto persistente)`() {
        // El error solo avanzó el sello (freno anti-spam): al pasar el minuto
        // vuelve a consultar en vez de silenciar para siempre. No hay prefs de
        // "visto": la decisión es publicada > instalada en cada chequeo.
        val errorAt = 1_000_000L
        assertFalse(OtaPolicy.shouldCheck(errorAt + 10_000L, errorAt, coldStart = false))
        assertTrue(OtaPolicy.shouldCheck(errorAt + 60_000L, errorAt, coldStart = false))
        assertTrue(OtaPolicy.isUpdateAvailable(290, 289))
    }
}

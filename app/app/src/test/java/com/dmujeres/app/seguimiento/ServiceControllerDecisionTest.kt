package com.dmujeres.app.seguimiento

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Decisión pura de recrear el controlador del servicio (JVM). */
class ServiceControllerDecisionTest {

    @Test
    fun `crear solo con permiso y sin controlador`() {
        assertTrue(TrackingService.shouldEnsureController(hasPermission = true, hasController = false))
    }

    @Test
    fun `con controlador existente no se duplica`() {
        assertFalse(TrackingService.shouldEnsureController(hasPermission = true, hasController = true))
    }

    @Test
    fun `sin permiso no se crea nada`() {
        assertFalse(TrackingService.shouldEnsureController(hasPermission = false, hasController = false))
        assertFalse(TrackingService.shouldEnsureController(hasPermission = false, hasController = true))
    }
}

package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Antiduplicado de entrega del fused (JVM, sin dispositivo).
 *
 * Caso real (dmt-db, tracking.dmt_posicion, dispositivo 50, 2026-09-28):
 * el fused entregó la misma observación dos veces y el almacén la guardó dos
 * veces con distinta secuencia (ids 94231/94232 con el MISMO fijado_en
 * 16:44:16.100, mismas coords, mismo boot_id, seq 35/36; igual 94233/94234 a
 * las 16:44:36.315 con seq 37/38). El dedupe del servidor no las atrapa
 * porque la identidad (boot, seq) se asigna por inserción.
 */
class DuplicateFixGuardTest {

    /** 2026-09-28 16:44:16.100 hora local (UTC-5) en epoch ms. */
    private val fijadoEn = 1_790_718_256_100L

    private val lat = -0.1807001
    private val lon = -78.4678345

    /** El almacén simulado consulta el guard igual que TrackingController.write. */
    private class AlmacenSimulado {
        private val puntos = ArrayList<DuplicateFixGuard.Fix>()

        /** Entrega un fix; devuelve true si se almacenó. */
        fun entregar(fix: DuplicateFixGuard.Fix): Boolean {
            val ultimo = puntos.lastOrNull()
            if (ultimo != null && DuplicateFixGuard.isDuplicate(fix, ultimo)) {
                return false
            }
            puntos.add(fix)
            return true
        }

        fun tamano(): Int = puntos.size
    }

    @Test
    fun `doble entrega del mismo ms con mismas coords solo se almacena una vez`() {
        val almacen = AlmacenSimulado()
        val observado = DuplicateFixGuard.Fix(fijadoEn, lat, lon)

        assertTrue(almacen.entregar(observado)) // seq 35
        assertFalse(almacen.entregar(observado)) // seq 36: misma observación
        assertEquals(1, almacen.tamano())

        // Segundo par real (16:44:36.315, 20,215 s después, punto distinto).
        val observado2 = DuplicateFixGuard.Fix(fijadoEn + 20_215L, lat + 0.0004123, lon - 0.0002871)
        assertTrue(almacen.entregar(observado2)) // seq 37
        assertFalse(almacen.entregar(observado2)) // seq 38: misma observación
        assertEquals(2, almacen.tamano())
    }

    @Test
    fun `un fix distinto 10 s despues si se almacena`() {
        val almacen = AlmacenSimulado()
        assertTrue(almacen.entregar(DuplicateFixGuard.Fix(fijadoEn, lat, lon)))
        // Cadencia ACTIVE (10 s): otro punto del trazo, se guarda.
        assertTrue(almacen.entregar(DuplicateFixGuard.Fix(fijadoEn + 10_000L, lat + 0.0001, lon)))
        assertEquals(2, almacen.tamano())
    }

    @Test
    fun `mismo punto con dt menor a 5 s se descarta`() {
        val ultimo = DuplicateFixGuard.Fix(fijadoEn, lat, lon)
        // Re-entrega por el segundo camino con captured_at apenas distinto.
        assertTrue(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn + 2_000L, lat, lon), ultimo))
        assertTrue(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn + 4_999L, lat, lon), ultimo))
    }

    @Test
    fun `mismo punto con cadencia real no se descarta`() {
        val ultimo = DuplicateFixGuard.Fix(fijadoEn, lat, lon)
        // Parado con cadencia ACTIVE (10 s) o STATIONARY (120 s): puntos
        // legítimos aunque no haya desplazamiento.
        assertFalse(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn + 5_000L, lat, lon), ultimo))
        assertFalse(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn + 10_000L, lat, lon), ultimo))
        assertFalse(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn + 120_000L, lat, lon), ultimo))
    }

    @Test
    fun `distintas coords con el mismo ms si se almacenan`() {
        val ultimo = DuplicateFixGuard.Fix(fijadoEn, lat, lon)
        // Solo el tiempo no basta: sin igualdad exacta de coords no hay duplicado.
        assertFalse(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn, lat + 0.0000001, lon), ultimo))
        assertFalse(DuplicateFixGuard.isDuplicate(DuplicateFixGuard.Fix(fijadoEn, lat, lon + 0.0000001), ultimo))
    }
}

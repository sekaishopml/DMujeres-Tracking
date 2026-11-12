package com.dmujeres.app.datos

import com.dmujeres.app.datos.Ajustes.Clave
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = com.dmujeres.app.sistema.MainApplication::class, sdk = [28])
class AjustesTest {
    @Test
    fun `sin ajustes del servidor quedan los de fabrica`() {
        assertEquals(1_000L, Ajustes.valorEn(emptyMap(), Clave.GPS_MARCHA_MS))
        assertEquals(20_000L, Ajustes.valorEn(emptyMap(), Clave.SIN_FIX_MARCHA_MS))
        assertEquals(180_000L, Ajustes.valorEn(emptyMap(), Clave.SUPERVISION_MS))
    }

    @Test
    fun `del servidor se toman solo los conocidos y dentro de rango`() {
        val leidos = Ajustes.leer(
            JSONObject("""{"gpsQuietaMs":30000,"supervisionMs":5,"otro":1,"sinFixMarchaMs":"x"}"""),
        )
        assertEquals(30_000L, Ajustes.valorEn(leidos, Clave.GPS_QUIETA_MS))
        assertEquals(180_000L, Ajustes.valorEn(leidos, Clave.SUPERVISION_MS))
        assertEquals(20_000L, Ajustes.valorEn(leidos, Clave.SIN_FIX_MARCHA_MS))
        assertEquals(setOf("gpsQuietaMs", "supervisionMs"), leidos.keys)
    }
}

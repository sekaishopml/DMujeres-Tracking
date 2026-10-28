package com.dmujeres.app.sistema

import com.dmujeres.app.sistema.OemAutostart.Marca
import org.junit.Assert.assertEquals
import org.junit.Test

class OemAutostartTest {

    @Test
    fun `reconoce las marcas de la flota`() {
        assertEquals(Marca.XIAOMI, OemAutostart.marcaDe("Xiaomi", "Redmi"))
        assertEquals(Marca.XIAOMI, OemAutostart.marcaDe("Xiaomi", "POCO"))
        assertEquals(Marca.HONOR, OemAutostart.marcaDe("HONOR", "HONOR"))
        assertEquals(Marca.HUAWEI, OemAutostart.marcaDe("HUAWEI", "HUAWEI"))
        assertEquals(Marca.SAMSUNG, OemAutostart.marcaDe("samsung", "samsung"))
        assertEquals(Marca.TRANSSION, OemAutostart.marcaDe("INFINIX MOBILITY LIMITED", "Infinix"))
        assertEquals(Marca.TRANSSION, OemAutostart.marcaDe("TECNO MOBILE LIMITED", "TECNO"))
        assertEquals(Marca.OTRA, OemAutostart.marcaDe("motorola", "motorola"))
        assertEquals(Marca.OTRA, OemAutostart.marcaDe(null, null))
    }
}

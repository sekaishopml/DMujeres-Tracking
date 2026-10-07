package com.dmujeres.app.sesion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Flujo de sesión, puro JVM (sin Android): guardar/reemplazar/limpiar token,
 * fallback a la clave compartida, 401 que limpia la sesión y aplicación de la
 * configuración recibida (solo claves conocidas y válidas).
 */
class SessionAuthTest {

    // ── Guardar / reemplazar / limpiar ──────────────────────────────────────

    @Test
    fun `guardar sesion deja token y usuario`() {
        val state = SessionStore.State().saved("abc123", "ana", "Ana", 999L)
        assertTrue(state.hasSession())
        assertEquals("abc123", state.token)
        assertEquals("ana", state.user)
    }

    @Test
    fun `entrar con otro usuario reemplaza la sesion anterior`() {
        val first = SessionStore.State().saved("token-1", "ana", "Ana", 100L)
        val second = first.saved("token-2", "luis", "Luis", 200L)
        assertEquals("token-2", second.token)
        assertEquals("luis", second.user)
        assertEquals("Luis", second.displayName)
    }

    @Test
    fun `cerrar sesion borra token y datos sin pedir login`() {
        val state = SessionStore.State().saved("abc123", "ana", "Ana", 999L).cleared()
        assertFalse(state.hasSession())
        assertEquals("", state.token)
        assertEquals("", state.user)
        assertEquals("", state.displayName)
        assertEquals(0L, state.expiresAtMs)
        assertFalse(state.authFailed)
    }

    // ── Fallback a clave compartida ─────────────────────────────────────────

    @Test
    fun `sin sesion se envia la clave compartida actual`() {
        val headers = SessionAuth.authHeaders(null, "clave-fabrica")
        assertEquals("clave-fabrica", headers["X-Api-Key"])
        assertNull(headers["Authorization"])
    }

    @Test
    fun `sin sesion y sin clave no hay cabecera de auth`() {
        assertTrue(SessionAuth.authHeaders("", "").isEmpty())
        assertTrue(SessionAuth.authHeaders(null, "").isEmpty())
    }

    @Test
    fun `con token se envia Bearer y no la clave compartida`() {
        val headers = SessionAuth.authHeaders("abc123", "clave-fabrica")
        assertEquals("Bearer abc123", headers["Authorization"])
        assertNull(headers["X-Api-Key"])
    }

    @Test
    fun `el estado sin sesion usa fallback y con sesion usa Bearer`() {
        val empty = SessionStore.State()
        assertEquals("clave-fabrica", empty.headers("clave-fabrica")["X-Api-Key"])
        val logged = empty.saved("abc123", "ana", "Ana", 999L)
        assertEquals("Bearer abc123", logged.headers("clave-fabrica")["Authorization"])
    }

    // ── 401 limpia la sesión (sin bucle) ────────────────────────────────────

    @Test
    fun `401 con token limpia la sesion y marca pedir login`() {
        assertTrue(SessionAuth.shouldClearSession(401, hadToken = true))
        val cleared = SessionStore.State().saved("abc123", "ana", "Ana", 999L).clearedOnUnauthorized()
        assertFalse(cleared.hasSession())
        assertEquals("", cleared.token)
        assertTrue(cleared.authFailed)
    }

    @Test
    fun `401 sin token no limpia nada (es la clave compartida)`() {
        assertFalse(SessionAuth.shouldClearSession(401, hadToken = false))
    }

    @Test
    fun `otros codigos con token no tocan la sesion`() {
        for (code in listOf(200, 400, 403, 404, 408, 429, 500, 503)) {
            assertEquals("código $code", false, SessionAuth.shouldClearSession(code, hadToken = true))
        }
    }

    // ── Respuesta del login ─────────────────────────────────────────────────

    @Test
    fun `extrae token vigencia nombre y configuracion del 200`() {
        val body = """{"token":"abc123","expiraEn":3600,"usuario":{"nombre":"Ana"},
            |"configuracion":{"intervalSeconds":10,"distanceMeters":25,"angleDegrees":30,
            |"accuracy":"high","bufferEnabled":false,"otraClave":1}}""".trimMargin()
        assertEquals("abc123", SessionAuth.extractToken(body))
        assertEquals(3600L, SessionAuth.extractExpiresInSeconds(body))
        assertEquals("Ana", SessionAuth.extractDisplayName(body))
        val config = SessionAuth.parseConfigBlock(SessionAuth.extractConfigBlock(body)!!)
        assertEquals("10", config.interval)
        assertEquals("25", config.distance)
        assertEquals("30", config.angle)
        assertEquals("high", config.accuracy)
        assertEquals(false, config.buffer)
    }

    @Test
    fun `200 sin token no sirve`() {
        assertNull(SessionAuth.extractToken("""{"expiraEn":3600}"""))
        assertNull(SessionAuth.extractToken(""))
    }

    @Test
    fun `configuracion ausente o rota se ignora sin tumbar el login`() {
        assertNull(SessionAuth.extractConfigBlock("""{"token":"x"}"""))
        assertNull(SessionAuth.extractConfigBlock("""{"configuracion":rotura"""))
    }

    @Test
    fun `solo claves conocidas y validas`() {
        val config = SessionAuth.parseConfigBlock(
            """{"intervalSeconds":1,"distanceMeters":-5,"angleDegrees":999,
            |"accuracy":"ultra","bufferEnabled":true,"admin":true}""".trimMargin(),
        )
        assertNull(config.interval)
        assertNull(config.distance)
        assertNull(config.angle)
        assertNull(config.accuracy)
        assertEquals(true, config.buffer)
    }

    // ── Normalización y cuerpo ──────────────────────────────────────────────

    @Test
    fun `usuario se normaliza sin espacios y en minusculas`() {
        assertEquals("ana", SessionAuth.normalizeUser("  Ana "))
    }

    @Test
    fun `cuerpo del login lleva usuario y clave`() {
        val json = SessionAuth.loginRequestJson("ana", "secreta", "inst-1234")
        assertTrue(json.contains("\"usuario\":\"ana\""))
        assertTrue(json.contains("\"clave\":\"secreta\""))
        assertTrue(json.contains("\"instalacion\":\"inst-1234\""))
    }

    // ── Equipo de la cuenta ─────────────────────────────────────────────────

    @Test
    fun `extrae el identificador del equipo vinculado`() {
        val body = """{"token":"t","usuario":{"nombre":"Santiago"},
            |"equipo":{"identificador":"equipo-b","nombre":"Equipo B"}}""".trimMargin()
        assertEquals("equipo-b", SessionAuth.extractEquipoIdentificador(body))
    }

    @Test
    fun `sin equipo no hay identificador que adoptar`() {
        val body = """{"token":"t","usuario":{"nombre":"Ana"},"equipo":null}"""
        assertEquals("", SessionAuth.extractEquipoIdentificador(body))
        assertEquals("", SessionAuth.extractEquipoIdentificador("{}"))
        assertEquals("", SessionAuth.extractEquipoIdentificador(""))
    }
}

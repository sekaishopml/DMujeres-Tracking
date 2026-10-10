package com.dmujeres.app.sesion

import com.dmujeres.app.datos.RemoteConfig
import com.dmujeres.app.red.DmujeresApi

/**
 * Lógica de la sesión sin Android (se prueba en la JVM).
 *
 * POST /api/mobile/v1/sesion {usuario, clave} responde:
 * - 200 {token, expiraEn, usuario:{nombre}, equipo:{identificador,nombre}|null,
 *   configuracion:{...}}
 * - 401 si el usuario o la clave no son correctos.
 * Las demás rutas aceptan `Authorization: Bearer <token>` o la clave
 * compartida.
 *
 * Lo que necesita Context o SharedPreferences está en [SessionStore] y
 * [DmujeresApi].
 */
object SessionAuth {

    /** Ruta del endpoint de sesión (contrato). */
    const val PATH_SESION = "/api/mobile/v1/sesion"

    /** Normaliza el usuario: sin espacios. Distingue mayúsculas: "Santiago" y "santiago" son cuentas distintas. */
    fun normalizeUser(raw: String): String = raw.trim()

    /** Cuerpo JSON del POST /sesion (escapado mínimo, sin dependencias). */
    // La instalación deja al servidor saber si la cuenta ya está abierta en
    // otro teléfono (solo se permite uno).
    fun loginRequestJson(usuario: String, clave: String, instalacion: String = ""): String =
        "{\"usuario\":\"${escape(usuario)}\",\"clave\":\"${escape(clave)}\",\"instalacion\":\"${escape(instalacion)}\"}"

    private fun escape(value: String): String =
        value.replace("\\", "\\\\").replace("\"", "\\\"")

    /** Extrae el token de un cuerpo 200. null = respuesta sin token utilizable. */
    fun extractToken(body: String): String? =
        Regex("\"token\"\\s*:\\s*\"([^\"]+)\"")
            .find(body)?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }

    /** Segundos de vigencia (`expiraEn`), o null. */
    fun extractExpiresInSeconds(body: String): Long? =
        Regex("\"expiraEn\"\\s*:\\s*(\\d+)")
            .find(body)?.groupValues?.getOrNull(1)?.toLongOrNull()

    /** Nombre visible (`usuario.nombre`). Vacío si no viene. */
    fun extractDisplayName(body: String): String =
        Regex("\"usuario\"\\s*:\\s*\\{[^}]*\"nombre\"\\s*:\\s*\"([^\"]*)\"")
            .find(body)?.groupValues?.getOrNull(1).orEmpty()

    /**
     * Identificador del equipo de la cuenta (`equipo.identificador`). Al
     * entrar, la app lo adopta para que la ruta quede en el equipo de la
     * persona. Vacío si la cuenta no tiene equipo: se conserva el actual.
     */
    fun extractEquipoIdentificador(body: String): String =
        Regex("\"equipo\"\\s*:\\s*\\{[^}]*\"identificador\"\\s*:\\s*\"([^\"]*)\"")
            .find(body)?.groupValues?.getOrNull(1)?.trim().orEmpty()

    /**
     * Bloque `configuracion` de la respuesta. null si falta o está mal; se
     * ignora sin romper el inicio de sesión.
     */
    fun extractConfigBlock(body: String): String? {
        val match = Regex("\"configuracion\"\\s*:\\s*\\{").find(body) ?: return null
        var start = -1
        var cursor = match.range.first
        while (cursor < body.length) {
            if (body[cursor] == '{') {
                start = cursor
                break
            }
            cursor++
        }
        if (start < 0) return null
        var depth = 0
        var index = start
        while (index < body.length) {
            when (body[index]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return body.substring(start, index + 1)
                }
            }
            index++
        }
        return null
    }

    /**
     * Configuración revisada: solo claves conocidas y con las mismas reglas
     * que `RemoteConfig` (intervalo de 3 s o más, distancia de 0 m o más,
     * ángulo de 0 a 180, precisión high, medium o low, y cola sí o no).
     */
    data class ValidConfig(
        val interval: String?,
        val distance: String?,
        val angle: String?,
        val accuracy: String?,
        val buffer: Boolean?,
    )

    fun parseConfigBlock(block: String): ValidConfig {
        fun long(key: String): Long? =
            Regex("\"$key\"\\s*:\\s*(-?\\d+)")
                .find(block)?.groupValues?.getOrNull(1)?.toLongOrNull()

        fun text(key: String): String? =
            Regex("\"$key\"\\s*:\\s*\"([^\"]*)\"")
                .find(block)?.groupValues?.getOrNull(1)

        fun flag(key: String): Boolean? =
            when (Regex("\"$key\"\\s*:\\s*(true|false)").find(block)?.groupValues?.getOrNull(1)) {
                "true" -> true
                "false" -> false
                else -> null
            }

        return ValidConfig(
            interval = long("intervalSeconds")?.takeIf { it >= 3 }?.toString(),
            distance = long("distanceMeters")?.takeIf { it >= 0 }?.toString(),
            angle = long("angleDegrees")?.takeIf { it in 0..180 }?.toString(),
            accuracy = text("accuracy")?.takeIf { it in setOf("high", "medium", "low") },
            buffer = flag("bufferEnabled"),
        )
    }

    /**
     * Cabeceras: con token se manda `Authorization: Bearer` sin la clave
     * compartida; sin token, la clave. Vacío si no hay ninguno de los dos.
     */
    fun authHeaders(token: String?, apiKey: String): Map<String, String> {
        if (!token.isNullOrBlank()) return mapOf("Authorization" to "Bearer ${token.trim()}")
        if (apiKey.isNotBlank()) return mapOf("X-Api-Key" to apiKey)
        return emptyMap()
    }

    /**
     * ¿Hay que borrar la sesión? Solo con un 401 y token (sesión revocada o
     * usuario deshabilitado). Sin token el 401 es de la clave compartida.
     */
    fun shouldClearSession(httpCode: Int, hadToken: Boolean): Boolean =
        hadToken && httpCode == 401

    /**
     * ¿Se lleva a entrar de nuevo? Solo con el cierre pendiente y la cola sin
     * puntos por enviar. Si no se pudo contar (-1) no se cierra.
     */
    fun puedeIrALogin(pendiente: Boolean, puntosPorEnviar: Int): Boolean =
        pendiente && puntosPorEnviar == 0
}

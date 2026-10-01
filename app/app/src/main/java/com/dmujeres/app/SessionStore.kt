package com.dmujeres.app

import android.content.Context
import androidx.preference.PreferenceManager

/**
 * Sesión de la persona (token de POST /api/mobile/v1/sesion).
 *
 * - Sin sesión la app sigue funcionando con la clave compartida.
 * - Entrar con otro usuario reemplaza la sesión anterior.
 * - Ante un 401 con token se borra la sesión y se pide entrar de nuevo
 *   ([clearOnUnauthorized]); lo capturado en el teléfono no se toca.
 *
 * [State] es una copia de lo guardado en las preferencias que se puede
 * probar sin Android; las funciones con Context la leen y la guardan.
 */
object SessionStore {

    const val KEY_TOKEN = "sesionToken"
    const val KEY_USER = "sesionUsuario"
    const val KEY_NAME = "sesionNombre"
    const val KEY_EXPIRES_AT = "sesionExpiraEnMs"

    /**
     * Marca de "hay que pedir login": se activa al limpiar por 401 y la
     * consume [takeAuthFailed] (una sola vez) para mostrar el aviso.
     */
    const val KEY_AUTH_FAILED = "sesionRequiereLogin"

    /** Réplica pura del contenido de la sesión (sin Android). */
    data class State(
        val token: String = "",
        val user: String = "",
        val displayName: String = "",
        val expiresAtMs: Long = 0L,
        val authFailed: Boolean = false,
    ) {
        /** Guarda (o reemplaza) la sesión. */
        fun saved(token: String, user: String, displayName: String, expiresAtMs: Long): State =
            copy(token = token, user = user, displayName = displayName, expiresAtMs = expiresAtMs, authFailed = false)

        /** Cerrar sesión manual: borra token y datos, sin pedir login. */
        fun cleared(): State =
            copy(token = "", user = "", displayName = "", expiresAtMs = 0L, authFailed = false)

        /** 401 con token: borra la sesión y deja marcado pedir login. */
        fun clearedOnUnauthorized(): State =
            copy(token = "", user = "", displayName = "", expiresAtMs = 0L, authFailed = true)

        fun hasSession(): Boolean = token.isNotBlank()

        /** Misma regla que [SessionAuth.authHeaders], sobre este estado. */
        fun headers(apiKey: String): Map<String, String> =
            SessionAuth.authHeaders(token.ifBlank { null }, apiKey)
    }

    private fun prefs(context: Context) =
        PreferenceManager.getDefaultSharedPreferences(context)

    /** Estado actual (lectura pura de prefs). */
    fun state(context: Context): State {
        val prefs = prefs(context)
        return State(
            token = prefs.getString(KEY_TOKEN, "").orEmpty(),
            user = prefs.getString(KEY_USER, "").orEmpty(),
            displayName = prefs.getString(KEY_NAME, "").orEmpty(),
            expiresAtMs = prefs.getLong(KEY_EXPIRES_AT, 0L),
            authFailed = prefs.getBoolean(KEY_AUTH_FAILED, false),
        )
    }

    /** Guarda (o reemplaza) la sesión y baja la marca de pedir login. */
    fun save(context: Context, token: String, user: String, displayName: String, expiresAtMs: Long) {
        prefs(context).edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER, user)
            .putString(KEY_NAME, displayName)
            .putLong(KEY_EXPIRES_AT, expiresAtMs)
            .putBoolean(KEY_AUTH_FAILED, false)
            .apply()
    }

    /** Cierre manual (debug): borra token y datos de sesión, sin marcas. */
    fun clear(context: Context) {
        prefs(context).edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER)
            .remove(KEY_NAME)
            .remove(KEY_EXPIRES_AT)
            .putBoolean(KEY_AUTH_FAILED, false)
            .apply()
    }

    /**
     * 401 con token: borra el token y los datos y marca que hay que entrar de
     * nuevo. No reintenta.
     */
    fun clearOnUnauthorized(context: Context) {
        prefs(context).edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER)
            .remove(KEY_NAME)
            .remove(KEY_EXPIRES_AT)
            .putBoolean(KEY_AUTH_FAILED, true)
            .apply()
    }

    fun token(context: Context): String =
        prefs(context).getString(KEY_TOKEN, "").orEmpty()

    fun user(context: Context): String =
        prefs(context).getString(KEY_USER, "").orEmpty()

    fun hasSession(context: Context): Boolean =
        token(context).isNotBlank()

    /**
     * Lee la marca de "entrar de nuevo" una sola vez: true = mostrar el aviso
     * ahora y no repetirlo hasta el próximo 401 con token.
     */
    fun takeAuthFailed(context: Context): Boolean {
        val prefs = prefs(context)
        if (!prefs.getBoolean(KEY_AUTH_FAILED, false)) return false
        prefs.edit().putBoolean(KEY_AUTH_FAILED, false).apply()
        return true
    }
}

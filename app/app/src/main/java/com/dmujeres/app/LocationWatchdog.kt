package com.dmujeres.app

/**
 * Vigilante PURO de frescura del GPS (testeable en JVM).
 *
 * Problema real en rutas largas: el proveedor fused puede quedarse "colgado"
 * (Doze, OEM, error de Play Services) y la app sigue viva sin recibir fixes;
 * el oficial no lo detecta y la ruta se corta en silencio.
 *
 * Decisión por [tick]:
 * - [Action.NONE] mientras haya fix dentro de [staleAfterMs];
 * - [Action.RE_REQUEST] (re-solicitar actualizaciones) en los primeros intentos;
 * - [Action.FALLBACK] (pasar al GPS del sistema) si sigue sin fix.
 */
class LocationWatchdog(
    private val staleAfterMs: Long = DEFAULT_STALE_MS,
    private val maxReRequests: Int = 2,
) {

    enum class Action { NONE, RE_REQUEST, FALLBACK }

    private var lastFixAtMs = -1L
    private var attempts = 0

    fun start(nowMs: Long) {
        lastFixAtMs = nowMs
        attempts = 0
    }

    fun noteFix(nowMs: Long) {
        lastFixAtMs = nowMs
        attempts = 0
    }

    fun tick(nowMs: Long): Action {
        if (lastFixAtMs < 0L) lastFixAtMs = nowMs
        if (nowMs - lastFixAtMs < staleAfterMs) return Action.NONE
        lastFixAtMs = nowMs
        attempts++
        return if (attempts <= maxReRequests) Action.RE_REQUEST else Action.FALLBACK
    }

    companion object {
        /** Sin fix durante 4 minutos se considera "colgado". */
        const val DEFAULT_STALE_MS = 4 * 60_000L
    }
}

package com.dmujeres.app.seguimiento

import com.dmujeres.app.datos.Ajustes

/**
 * Vigilante PURO de frescura del GPS (testeable en JVM).
 *
 * Problema real en rutas largas: el proveedor puede quedarse "colgado" (Doze,
 * ahorro del fabricante, error de Play Services, techo) y la app sigue viva
 * sin recibir posiciones. Antes, tras dos intentos pasaba una sola vez al GPS
 * del sistema y ahí se quedaba: bajo techo ese GPS nunca responde y se
 * perdían horas (equipo 96: 213 rescates seguidos sin un punto).
 *
 * Decisión por [tick]:
 * - [Action.NONE] mientras haya fix dentro de [staleAfterMs];
 * - [Action.RE_REQUEST] (volver a pedir al mismo proveedor) en los primeros intentos;
 * - [Action.NEXT_PROVIDER] después, en cada período sin fix: el controlador
 *   pasa al siguiente proveedor de la escalera y vuelve a empezar. Nunca se rinde.
 */
class LocationWatchdog(
    private val staleAfterMs: Long = Ajustes.valor(Ajustes.Clave.SIN_FIX_QUIETA_MS),
    private val maxReRequests: Int = 1,
) {

    enum class Action { NONE, RE_REQUEST, NEXT_PROVIDER }

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

    /** ¿Lleva más de [staleAfterMs] sin un fix? */
    fun isStale(nowMs: Long): Boolean = lastFixAtMs >= 0L && nowMs - lastFixAtMs >= staleAfterMs

    /**
     * En movimiento cada segundo sin posición es ruta perdida: a los
     * tiempo de `sinFixMarchaMs` (ver Ajustes) se sube de escalón sin volver a pedir al mismo proveedor.
     */
    fun tick(nowMs: Long, moving: Boolean = false): Action {
        if (lastFixAtMs < 0L) lastFixAtMs = nowMs
        val limite = if (moving) minOf(staleAfterMs, Ajustes.valor(Ajustes.Clave.SIN_FIX_MARCHA_MS)) else staleAfterMs
        if (nowMs - lastFixAtMs < limite) return Action.NONE
        lastFixAtMs = nowMs
        attempts++
        return if (!moving && attempts <= maxReRequests) Action.RE_REQUEST else Action.NEXT_PROVIDER
    }
}

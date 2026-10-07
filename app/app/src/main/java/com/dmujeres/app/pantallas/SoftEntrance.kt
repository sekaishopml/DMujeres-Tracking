package com.dmujeres.app.pantallas

import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * Entrada suave de las pantallas del asistente: desvanecido + desplazamiento
 * corto + un zoom mínimo, con ViewPropertyAnimator (barato y a 60 fps).
 * Sin desenfoque: el blur por GPU causaba lag en los equipos de la flota.
 */
object SoftEntrance {

    fun animate(
        view: View,
        delayMs: Long = 0L,
        durationMs: Long = 420L,
        slideDp: Float = 16f,
    ) {
        if (animationsDisabled(view)) {
            // Accesibilidad o rendimiento: sin animación, contenido visible ya.
            view.alpha = 1f
            view.translationY = 0f
            view.scaleX = 1f
            view.scaleY = 1f
            return
        }
        val density = view.resources.displayMetrics.density
        view.alpha = 0f
        view.translationY = slideDp * density
        // Zoom mínimo: da la sensación de "aparecer" sin mover el layout.
        view.scaleX = 0.985f
        view.scaleY = 0.985f
        view.animate()
            .alpha(1f)
            .translationY(0f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(delayMs)
            .setDuration(durationMs)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    /** Transición entre pasos: misma entrada, un poco más corta. */
    fun transition(view: View, durationMs: Long = 260L) {
        animate(view, delayMs = 0L, durationMs = durationMs, slideDp = 10f)
    }

    /** ¿El usuario desactivó las animaciones (accesibilidad) o el sistema las escala a 0? */
    private fun animationsDisabled(view: View): Boolean = runCatching {
        android.provider.Settings.Global.getFloat(
            view.context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }.getOrDefault(false)
}

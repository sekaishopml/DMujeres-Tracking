package com.dmujeres.app.pantallas

import android.annotation.SuppressLint
import android.graphics.drawable.TransitionDrawable
import android.transition.AutoTransition
import android.transition.ChangeBounds
import android.transition.Fade
import android.transition.TransitionSet
import android.view.animation.PathInterpolator
import android.transition.TransitionManager
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.dmujeres.app.R

/** Movimientos comunes de las pantallas: entrada, toque, cambio de estado. */
object Animaciones {

    /** Cada vista aparece con un fundido, una tras otra (sin moverse: mareaba). */
    fun entradaEscalonada(vistas: List<View>, inicioMs: Long = 60, pasoMs: Long = 70) {
        vistas.forEachIndexed { i, v ->
            v.alpha = 0f
            v.animate().alpha(1f)
                .setStartDelay(inicioMs + i * pasoMs).setDuration(380)
                .setInterpolator(DecelerateInterpolator(1.8f)).start()
        }
    }

    /**
     * Al tocar, la vista se oscurece un instante y vuelve; no cambia de
     * tamaño (encoger y rebotar mareaba) y no consume el toque.
     */
    @SuppressLint("ClickableViewAccessibility")
    fun respuestaAlToque(vararg vistas: View?) {
        vistas.filterNotNull().forEach { v ->
            v.setOnTouchListener { vista, e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> vista.animate().alpha(0.72f).setDuration(60).start()
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                        vista.animate().alpha(1f).setDuration(160).start()
                }
                false
            }
        }
    }

    /** Anima los cambios de tamaño y aparición de lo que cuelga de [raiz]. */
    fun suave(raiz: ViewGroup, ms: Long = 260) {
        TransitionManager.beginDelayedTransition(raiz, AutoTransition().setDuration(ms))
    }

    /**
     * Cambio de estado como un fluido: lo que crece, se encoge o se mueve lo
     * hace con una curva que arranca rápido y se asienta suave, y lo que
     * aparece o se va, se funde.
     */
    fun fluido(raiz: ViewGroup) {
        if (!raiz.isAttachedToWindow) return
        // Primero se desvanece lo que sale, luego todo se acomoda a su lugar
        // nuevo y al final aparece lo que entra: un solo movimiento continuo.
        val curva = PathInterpolator(0.2f, 0f, 0f, 1f)
        TransitionManager.beginDelayedTransition(
            raiz,
            TransitionSet()
                .addTransition(Fade(Fade.OUT).setDuration(140))
                .addTransition(ChangeBounds().setDuration(320).setInterpolator(curva))
                .addTransition(Fade(Fade.IN).setDuration(240))
                .setOrdering(TransitionSet.ORDERING_SEQUENTIAL),
        )
    }

    /** Muestra u oculta [vista] acomodando con suavidad lo que cuelga de [raiz]. */
    fun mostrar(raiz: ViewGroup, vista: View, visible: Boolean) {
        val destino = if (visible) View.VISIBLE else View.GONE
        if (vista.visibility == destino) return
        if (raiz.isAttachedToWindow) suave(raiz)
        vista.visibility = destino
    }

    /** Cambio de texto con fundido; si ya dice lo mismo no hace nada. */
    fun texto(vista: TextView, nuevo: String) {
        if (((vista.tag as? String) ?: vista.text.toString()) == nuevo) return
        if (vista.text.isNullOrEmpty() || !vista.isAttachedToWindow) {
            vista.text = nuevo
            return
        }
        vista.tag = nuevo
        fun aplicar() {
            val t = vista.tag as? String ?: return
            vista.tag = null
            vista.text = t
        }
        vista.animate().cancel()
        vista.animate().alpha(0f).setDuration(110).withEndAction {
            aplicar()
            vista.animate().alpha(1f).setDuration(180).start()
        }.start()
        // Si otra animación de la vista reemplaza a esta, el texto igual se actualiza.
        vista.postDelayed({ aplicar() }, 250)
    }

    /** Cambia el fondo con un fundido entre el actual y [recurso]. */
    fun fondo(vista: View, recurso: Int, ms: Int = 350) {
        val actual = vista.getTag(R.id.tag_fondo) as? Int
        if (actual == recurso) return
        vista.setTag(R.id.tag_fondo, recurso)
        val nuevo = ContextCompat.getDrawable(vista.context, recurso)
        val anterior = actual?.let { ContextCompat.getDrawable(vista.context, it) }
        if (nuevo == null || anterior == null) {
            vista.setBackgroundResource(recurso)
            return
        }
        val t = TransitionDrawable(arrayOf(anterior, nuevo))
        vista.background = t
        t.startTransition(ms)
    }

    /** Pequeño salto para destacar que un número cambió. */
    fun pulso(vista: View, escala: Float = 1.18f) {
        vista.animate().cancel()
        vista.scaleX = escala
        vista.scaleY = escala
        vista.animate().scaleX(1f).scaleY(1f).setDuration(260)
            .setInterpolator(DecelerateInterpolator()).start()
    }
}

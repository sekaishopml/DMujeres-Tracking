package com.dmujeres.app.pantallas

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView

/**
 * Réplica pequeña de un control de la app para la guía: un dedo lo toca y el
 * control cambia de estado, en bucle. Solo ilustra; no hace nada real.
 */
class DemoControl(
    context: Context,
    private val marcos: List<Marco>,
    // Aviso de actualización: su icono y la forma del aviso real (cuelga del borde de arriba).
    private val icono: Int? = null,
    private val comoAviso: Boolean = false,
) : FrameLayout(context) {

    class Marco(val texto: String, val fondo: Int, val colorTexto: Int, val tocar: Boolean = false)

    private val densidad = resources.displayMetrics.density
    private fun dp(v: Int) = (v * densidad).toInt()

    private val boton = TextView(context).apply {
        gravity = Gravity.CENTER
        if (!comoAviso) setTypeface(typeface, Typeface.BOLD)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (comoAviso) 13f else 14f)
        setPadding(dp(12), 0, dp(12), 0)
        maxLines = if (comoAviso) 2 else 1
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private val dedo = View(context).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (comoAviso) 0x66_FFFFFF else 0x66_0B2545) }
        alpha = 0f
    }
    private val reloj = Handler(Looper.getMainLooper())
    private var indice = 0
    private val siguiente = Runnable { mostrar() }

    init {
        minimumHeight = dp(56)
        addView(boton, LayoutParams(LayoutParams.MATCH_PARENT, dp(46)).apply { gravity = Gravity.CENTER })
        addView(dedo, LayoutParams(dp(30), dp(30)).apply { gravity = Gravity.CENTER })
        aplicar(marcos[0])
        indice = 1
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        reloj.postDelayed(siguiente, 1800)
    }

    override fun onDetachedFromWindow() {
        reloj.removeCallbacksAndMessages(null)
        super.onDetachedFromWindow()
    }

    private fun mostrar() {
        val marco = marcos[indice % marcos.size]
        indice++
        if (marco.tocar) {
            dedo.animate().alpha(0.9f).setDuration(200).withEndAction {
                aplicar(marco)
                dedo.animate().alpha(0f).setDuration(200).start()
            }.start()
        } else {
            aplicar(marco)
        }
        reloj.postDelayed(siguiente, 1800)
    }

    private fun aplicar(marco: Marco) {
        boton.text = conIcono(marco)
        boton.setTextColor(marco.colorTexto)
        boton.background = GradientDrawable().apply {
            if (comoAviso) {
                val r = dp(14).toFloat()
                cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, r, r, r, r)
            } else {
                cornerRadius = dp(10).toFloat()
            }
            setColor(marco.fondo)
        }
    }

    private fun conIcono(marco: Marco): CharSequence {
        val dibujo = icono?.let { androidx.core.content.ContextCompat.getDrawable(context, it) }?.mutate() ?: return marco.texto
        dibujo.setTint(marco.colorTexto)
        dibujo.setBounds(0, 0, dp(16), dp(16))
        return android.text.SpannableStringBuilder("x  ${marco.texto}").apply {
            setSpan(android.text.style.ImageSpan(dibujo, android.text.style.ImageSpan.ALIGN_BASELINE), 0, 1, 0)
        }
    }
}

/**
 * Réplica de un trozo real de la app, cuadro a cuadro: cada cuadro arma su
 * vista con los mismos fondos, colores y textos que la pantalla de verdad, y
 * un dedo toca donde tocaría la persona antes de pasar al siguiente.
 */
class DemoEscena(context: Context, private val cuadros: List<Cuadro>) : FrameLayout(context) {

    /** [tocarX]/[tocarY]: dónde toca el dedo (0 a 1) antes de mostrar este cuadro; sin tocarX no hay toque. */
    class Cuadro(val tocarX: Float? = null, val tocarY: Float = 0.5f, val vista: () -> View)

    private val densidad = resources.displayMetrics.density
    private fun dp(v: Int) = (v * densidad).toInt()

    private val lienzo = FrameLayout(context)
    private val dedo = View(context).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0x660B2545) }
        alpha = 0f
    }
    private val reloj = Handler(Looper.getMainLooper())
    private var indice = 0
    private val siguiente = Runnable { avanzar() }

    init {
        addView(lienzo, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(dedo, LayoutParams(dp(30), dp(30)))
        poner(cuadros[0])
        indice = 1
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        reloj.postDelayed(siguiente, PAUSA_MS)
    }

    override fun onDetachedFromWindow() {
        reloj.removeCallbacksAndMessages(null)
        super.onDetachedFromWindow()
    }

    private fun poner(cuadro: Cuadro) {
        lienzo.removeAllViews()
        lienzo.addView(cuadro.vista(), LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    private fun avanzar() {
        val cuadro = cuadros[indice % cuadros.size]
        indice++
        val x = cuadro.tocarX
        if (x == null) {
            poner(cuadro)
        } else {
            dedo.x = lienzo.width * x - dedo.width / 2f
            dedo.y = lienzo.height * cuadro.tocarY - dedo.height / 2f
            dedo.animate().alpha(0.9f).setDuration(200).withEndAction {
                poner(cuadro)
                dedo.animate().alpha(0f).setDuration(200).start()
            }.start()
        }
        reloj.postDelayed(siguiente, PAUSA_MS)
    }

    private companion object {
        const val PAUSA_MS = 2000L
    }
}

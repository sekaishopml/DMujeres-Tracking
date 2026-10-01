package com.dmujeres.app

import android.content.Context
import android.util.AttributeSet
import android.util.TypedValue
import android.view.Gravity
import android.view.animation.AlphaAnimation
import android.view.animation.AnimationSet
import android.view.animation.PathInterpolator
import android.view.animation.TranslateAnimation
import android.widget.LinearLayout
import android.widget.TextSwitcher
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Contador tipo odómetro para el porcentaje de descarga: cada cifra es una
 * columna propia y solo se anima la que cambia; la nueva entra desde abajo y
 * la anterior sale hacia arriba con una curva suave (sin cortes). Así, de 23 a
 * 24 el "2" queda fijo y solo rueda el "3" → "4".
 */
class Odometro @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : LinearLayout(context, attrs) {

    private val columnas = mutableListOf<TextSwitcher>()
    private var actual = ""
    private val curva = PathInterpolator(0.22f, 0.9f, 0.28f, 1f)
    private val tamanoSp = 40f

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER
    }

    fun setValor(valor: Int) {
        val texto = valor.coerceIn(0, 100).toString()
        if (texto == actual) return
        // Columnas a la derecha: al pasar de 9 a 10 se agrega una a la izquierda.
        while (columnas.size < texto.length) {
            val columna = nuevaColumna()
            columnas.add(0, columna)
            addView(columna, 0)
        }
        while (columnas.size > texto.length) {
            removeView(columnas.removeAt(0))
        }
        val previo = actual.padStart(texto.length, ' ')
        texto.forEachIndexed { i, cifra ->
            if (previo[i] != cifra) {
                if (previo[i] == ' ') columnas[i].setCurrentText(cifra.toString()) else columnas[i].setText(cifra.toString())
            }
        }
        actual = texto
    }

    private fun nuevaColumna(): TextSwitcher = TextSwitcher(context).apply {
        setFactory {
            TextView(context).apply {
                setTextSize(TypedValue.COMPLEX_UNIT_SP, tamanoSp)
                setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                typeface = android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL)
                includeFontPadding = false
                gravity = Gravity.CENTER
            }
        }
        inAnimation = AnimationSet(true).apply {
            addAnimation(TranslateAnimation(
                TranslateAnimation.RELATIVE_TO_SELF, 0f, TranslateAnimation.RELATIVE_TO_SELF, 0f,
                TranslateAnimation.RELATIVE_TO_SELF, 0.9f, TranslateAnimation.RELATIVE_TO_SELF, 0f,
            ))
            addAnimation(AlphaAnimation(0f, 1f))
            duration = DURACION_MS
            interpolator = curva
        }
        outAnimation = AnimationSet(true).apply {
            addAnimation(TranslateAnimation(
                TranslateAnimation.RELATIVE_TO_SELF, 0f, TranslateAnimation.RELATIVE_TO_SELF, 0f,
                TranslateAnimation.RELATIVE_TO_SELF, 0f, TranslateAnimation.RELATIVE_TO_SELF, -0.9f,
            ))
            addAnimation(AlphaAnimation(1f, 0f))
            duration = DURACION_MS
            interpolator = curva
        }
        clipChildren = true
    }

    private companion object {
        const val DURACION_MS = 320L
    }
}

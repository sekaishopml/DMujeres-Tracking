package com.dmujeres.app.cronograma

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.widget.OverScroller
import androidx.core.content.ContextCompat
import com.dmujeres.app.R
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Rueda de hora y minuto: se arrastra con el dedo, sigue con inercia al
 * soltar y se asienta en un valor exacto. Dibuja todo en un solo View, sin
 * crear vistas al moverse. Con [minimo] la rueda no baja de ese valor: se
 * queda bloqueada en él (la hora "hasta" no puede ser menor que "desde").
 */
class RuedaHora @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    /** Se llama con los minutos del día cada vez que cambia el valor asentado o arrastrado. */
    var alCambiar: ((Int) -> Unit)? = null

    private val dp = resources.displayMetrics.density
    private val alto = 38 * dp
    private val filas = 5

    private val pintura = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }
    private val banda = Paint().apply { color = ContextCompat.getColor(context, R.color.line) }
    private val colorFuerte = ContextCompat.getColor(context, R.color.text_primary)
    private val colorSuave = ContextCompat.getColor(context, R.color.text_tertiary)
    private val colorFondo = ContextCompat.getColor(context, R.color.surface)

    // Posición de cada columna en filas (0 = hora, 1 = minuto); el valor elegido es la fila redondeada.
    private val pos = floatArrayOf(8f, 0f)
    private val tope = intArrayOf(23, 59)
    private val desplazador = arrayOf(OverScroller(context), OverScroller(context))
    private var minimo = 0
    private var columna = -1
    private var ultimoY = 0f
    private var velocidad: VelocityTracker? = null
    private val umbral = android.view.ViewConfiguration.get(context).scaledTouchSlop
    private var arrastrando = false
    private var inicioY = 0f

    /** Minutos del día que marca la rueda. */
    val valor: Int get() = pos[0].roundToInt() * 60 + pos[1].roundToInt()

    fun poner(minutos: Int, minimoMin: Int = 0) {
        minimo = minimoMin.coerceIn(0, 23 * 60 + 59)
        val m = minutos.coerceIn(minimo, 23 * 60 + 59)
        desplazador.forEach { it.forceFinished(true) }
        pos[0] = (m / 60).toFloat()
        pos[1] = (m % 60).toFloat()
        invalidate()
    }

    // Límite inferior de cada columna según el mínimo: los minutos solo se limitan en la hora mínima.
    private fun piso(c: Int): Float = if (c == 0) (minimo / 60).toFloat()
    else if (pos[0].roundToInt() == minimo / 60) (minimo % 60).toFloat() else 0f

    private fun poner(c: Int, p: Float) {
        val nuevo = p.coerceIn(piso(c), tope[c].toFloat())
        if (nuevo == pos[c]) return
        val antes = valor
        pos[c] = nuevo
        // Si al cambiar de hora el minuto queda bajo el mínimo, sube a él.
        if (c == 0 && pos[1] < piso(1)) pos[1] = piso(1)
        invalidate()
        if (valor != antes) alCambiar?.invoke(valor)
    }

    override fun onMeasure(w: Int, h: Int) {
        setMeasuredDimension(getDefaultSize(suggestedMinimumWidth, w), (alto * filas).toInt())
    }

    private val bandaFila = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.line)
    }
    private val fundido = Paint()
    private val radioBanda = 12 * dp

    override fun onDraw(canvas: Canvas) {
        val centroY = height / 2f
        // Pastilla de la fila elegida: marca dónde cae el valor.
        canvas.drawRoundRect(4 * dp, centroY - alto / 2, width - 4 * dp, centroY + alto / 2, radioBanda, radioBanda, bandaFila)
        canvas.drawRect(0f, centroY - alto / 2, width.toFloat(), centroY - alto / 2 + 1 * dp, banda)
        canvas.drawRect(0f, centroY + alto / 2, width.toFloat(), centroY + alto / 2 + 1 * dp, banda)
        for (c in 0..1) {
            val x = width * (if (c == 0) 0.35f else 0.65f)
            val centro = pos[c]
            val base = centro.roundToInt()
            for (i in base - filas / 2 - 1..base + filas / 2 + 1) {
                if (i < 0 || i > tope[c]) continue
                val d = i - centro
                val y = centroY + d * alto
                val cerca = (1f - abs(d) / (filas / 2f + 0.5f)).coerceIn(0f, 1f)
                pintura.textSize = (16f + 10f * cerca) * dp
                pintura.color = if (abs(d) < 0.5f && i >= piso(c)) colorFuerte else colorSuave
                pintura.alpha = (60 + 195 * cerca).toInt()
                canvas.drawText("%02d".format(i), x, y - (pintura.ascent() + pintura.descent()) / 2, pintura)
            }
        }
        pintura.alpha = 255
        pintura.color = colorFuerte
        pintura.textSize = 26 * dp
        canvas.drawText(":", width / 2f, centroY - (pintura.ascent() + pintura.descent()) / 2, pintura)
        // Los extremos se desvanecen hacia la superficie: la rueda parece girar.
        fundido.shader = android.graphics.LinearGradient(
            0f, 0f, 0f, height.toFloat(),
            intArrayOf(colorFondo, 0x00000000, 0x00000000, colorFondo),
            floatArrayOf(0f, 0.3f, 0.7f, 1f),
            android.graphics.Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fundido)
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                columna = if (e.x < width / 2f) 0 else 1
                desplazador[columna].forceFinished(true)
                removeCallbacks(paso)
                ultimoY = e.y
                inicioY = e.y
                arrastrando = false
                velocidad = VelocityTracker.obtain().also { it.addMovement(e) }
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> {
                velocidad?.addMovement(e)
                if (!arrastrando && abs(e.y - inicioY) > umbral) arrastrando = true
                if (arrastrando) {
                    // Dedo hacia arriba sube el valor; no pasa del mínimo ni del máximo.
                    poner(columna, pos[columna] - (e.y - ultimoY) / alto)
                    ultimoY = e.y
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val v = velocidad
                v?.computeCurrentVelocity(1000)
                val vy = v?.yVelocity ?: 0f
                v?.recycle()
                velocidad = null
                if (e.actionMasked == MotionEvent.ACTION_UP && !arrastrando) performClick()
                lanzar(columna, vy)
            }
        }
        return true
    }

    override fun performClick(): Boolean = super.performClick()

    private var asentando = false

    private val paso = object : Runnable {
        override fun run() {
            val c = columna
            val s = desplazador[c]
            if (s.computeScrollOffset()) {
                poner(c, s.currY / alto)
                postOnAnimation(this)
            } else if (!asentando) {
                // Terminó la inercia: se asienta en la fila exacta más cercana.
                asentando = true
                val actual = (pos[c] * alto).toInt()
                val destino = (pos[c].roundToInt() * alto).toInt()
                s.startScroll(0, actual, 0, destino - actual, 320)
                postOnAnimation(this)
            } else {
                pos[c] = pos[c].roundToInt().toFloat().coerceIn(piso(c), tope[c].toFloat())
                invalidate()
            }
        }
    }

    // Inercia con el tope en el mínimo y el máximo: no sigue pasando de ahí.
    private fun lanzar(c: Int, vy: Float) {
        if (c < 0) return
        val s = desplazador[c]
        s.forceFinished(true)
        asentando = false
        // Más lenta que el dedo: la rueda avanza con calma y no se pasa de largo.
        s.fling(0, (pos[c] * alto).toInt(), 0, (-vy * 0.5f).toInt(), 0, 0, (piso(c) * alto).toInt(), (tope[c] * alto).toInt())
        removeCallbacks(paso)
        postOnAnimation(paso)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(paso)
        velocidad?.recycle()
        velocidad = null
        super.onDetachedFromWindow()
    }
}

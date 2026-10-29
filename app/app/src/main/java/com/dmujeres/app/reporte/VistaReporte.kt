package com.dmujeres.app.reporte

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.ColorInt
import com.dmujeres.app.R
import com.dmujeres.app.pantallas.Animaciones

/**
 * El reporte en vistas del teléfono: los días para elegir (semana o mes) y la
 * planilla del día elegido, con las mismas columnas y colores que el Excel y
 * el PDF, para que se reconozca como el mismo documento.
 */
object VistaReporte {

    fun pintar(contenedor: LinearLayout, r: Reporte, elegido: String, alElegir: (String) -> Unit) {
        val ctx = contenedor.context
        contenedor.removeAllViews()
        if (r.periodo != Periodo.DIA) contenedor.addView(selectorDias(ctx, r, elegido, alElegir))
        val i = r.dias.indexOfFirst { it.fecha == elegido }.coerceAtLeast(0)
        val columna = PlanillaReporte.bloques(r).flatMap { it.columnas }[i]
        contenedor.addView(planilla(ctx, r.dias[i], columna))
    }

    // ── Días ────────────────────────────────────────────────────────────────

    private fun selectorDias(ctx: Context, r: Reporte, elegido: String, alElegir: (String) -> Unit): View {
        // La semana entra completa en el ancho; el mes se recorre de lado.
        val semana = r.periodo == Periodo.SEMANA
        val fila = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(ctx, 16), 0, dp(ctx, if (semana) 12 else 10), 0)
        }
        var marcado: View? = null
        for (dia in r.dias) {
            val si = dia.fecha == elegido
            val color = colorDia(dia.fecha)
            val celda = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                // Como el encabezado de la planilla: el color del día; el elegido, entero y con borde.
                background = GradientDrawable().apply {
                    setColor(hex(if (si) color else PlanillaReporte.tinte(color, 40)))
                    cornerRadius = dp(ctx, 4).toFloat()
                    if (si) setStroke(dp(ctx, 2), ctx.getColor(R.color.navy))
                }
                layoutParams = LinearLayout.LayoutParams(if (semana) 0 else dp(ctx, 48), dp(ctx, 52), if (semana) 1f else 0f)
                    .apply { marginEnd = dp(ctx, 4) }
                contentDescription = dia.etiqueta
                addView(texto(ctx, dia.etiqueta.take(3), 12f, R.color.text_primary).apply { gravity = Gravity.CENTER })
                addView(texto(ctx, dia.fecha.substring(8), 16f, R.color.text_primary, negrita = true).apply { gravity = Gravity.CENTER })
                setOnClickListener { if (!si) alElegir(dia.fecha) }
            }
            Animaciones.respuestaAlToque(celda)
            if (si) marcado = celda
            fila.addView(celda)
        }
        if (semana) return fila.apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        return HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(fila)
            // El día elegido queda a la vista (en el mes puede estar lejos).
            marcado?.let { m -> post { scrollTo((m.left - (width - m.width) / 2).coerceAtLeast(0), 0) } }
        }
    }

    // ── Planilla del día ────────────────────────────────────────────────────

    private fun planilla(ctx: Context, dia: DiaReporte, columna: PlanillaReporte.Columna): View {
        val color = colorDia(dia.fecha)
        val horaFondo = hex(PlanillaReporte.tinte(color, 30))
        val jornadaFondo = hex(PlanillaReporte.tinte(color, 12))
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke(dp(ctx, 1), BORDE)
            }
            setPadding(dp(ctx, 1), dp(ctx, 1), dp(ctx, 1), dp(ctx, 1))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { setMargins(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), 0) }

            addView(texto(ctx, dia.etiqueta, 15f, R.color.text_primary, negrita = true).apply {
                setBackgroundColor(hex(color))
                gravity = Gravity.CENTER
                setPadding(0, dp(ctx, 8), 0, dp(ctx, 8))
            })
            val encabezado = hex(PlanillaReporte.tinte(color, 45))
            addView(fila(ctx, ctx.getString(R.string.rep_col_hora), encabezado, encabezado, encabezado = true) {
                texto(ctx, ctx.getString(R.string.rep_col_plan), 12f, R.color.text_primary, negrita = true)
            })

            // Inicio arriba y fin abajo, tal como los arma la planilla.
            val inicio = columna.filas.first()
            addView(linea(ctx))
            addView(fila(ctx, inicio.hora, horaFondo, jornadaFondo) { texto(ctx, inicio.plan, 15f, R.color.text_primary, negrita = true) })

            if (dia.actividades.isEmpty()) {
                addView(linea(ctx))
                addView(fila(ctx, "", horaFondo, null) { texto(ctx, ctx.getString(R.string.rep_sin_actividades), 14f, R.color.text_secondary) })
            }
            dia.actividades.forEach { a ->
                addView(linea(ctx))
                addView(fila(ctx, a.horaFin?.let { "${a.hora} a $it" } ?: a.hora, horaFondo, null) { actividad(ctx, a) })
            }

            val fin = columna.filas.last()
            if (fin.hora.isNotBlank() || fin.plan.isNotBlank()) {
                val partes = fin.plan.ifBlank { ctx.getString(R.string.rep_fin_jornada) }.split(": ", limit = 2)
                addView(linea(ctx))
                addView(fila(ctx, fin.hora, horaFondo, jornadaFondo) {
                    LinearLayout(ctx).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(texto(ctx, partes[0], 15f, R.color.text_primary, negrita = true))
                        partes.getOrNull(1)?.let { addView(texto(ctx, it, 14f, R.color.text_secondary)) }
                    }
                })
            }
        }
    }

    /** Lugar arriba; debajo, el tipo (si no es una visita) y la nota, como en la planilla. */
    private fun actividad(ctx: Context, a: FilaActividad) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        val lugar = a.lugar?.takeIf { it.isNotBlank() }
        val detalle = listOfNotNull(
            a.tipo.takeIf { lugar != null && it != "Visita" },
            a.nota?.takeIf { it.isNotBlank() },
        ).joinToString(". ")
        addView(texto(ctx, lugar ?: a.tipo, 15f, R.color.text_primary))
        if (detalle.isNotEmpty()) addView(texto(ctx, detalle, 14f, R.color.text_secondary))
    }

    // ── Piezas ──────────────────────────────────────────────────────────────

    /** Una fila de la planilla: la hora en su columna de color y el contenido al lado. */
    private fun fila(
        ctx: Context, hora: String, @ColorInt horaFondo: Int, @ColorInt fondo: Int?, encabezado: Boolean = false, contenido: () -> View,
    ) =
        LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            val ancho = dp(ctx, 72)
            // La columna de la hora se pinta en el fondo de la fila: así llega
            // hasta abajo aunque la hora o el contenido ocupen dos líneas.
            background = object : Drawable() {
                private val pintura = Paint()
                override fun draw(c: Canvas) {
                    fondo?.let { pintura.color = it; c.drawRect(bounds, pintura) }
                    pintura.color = horaFondo
                    c.drawRect(bounds.left.toFloat(), bounds.top.toFloat(), (bounds.left + ancho).toFloat(), bounds.bottom.toFloat(), pintura)
                }
                override fun setAlpha(alpha: Int) = Unit
                override fun setColorFilter(filtro: ColorFilter?) = Unit
                @Deprecated("Requerido por Drawable")
                override fun getOpacity() = PixelFormat.TRANSLUCENT
            }
            addView(texto(ctx, hora, if (encabezado) 12f else 14f, R.color.text_primary, negrita = encabezado).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(ctx, 6), dp(ctx, 10), dp(ctx, 6), dp(ctx, 10))
                layoutParams = LinearLayout.LayoutParams(ancho, ViewGroup.LayoutParams.WRAP_CONTENT)
            })
            addView(contenido().apply {
                setPadding(dp(ctx, 12), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
        }

    private fun linea(ctx: Context) = View(ctx).apply {
        setBackgroundColor(BORDE)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(ctx, 1))
    }

    private fun texto(ctx: Context, s: String, sp: Float, color: Int, negrita: Boolean = false) = TextView(ctx).apply {
        text = s
        textSize = sp
        setTextColor(ctx.getColor(color))
        if (negrita) setTypeface(typeface, Typeface.BOLD)
    }

    /** Gris de las líneas de la planilla, algo más suave que el del Excel impreso. */
    private val BORDE = Color.parseColor("#C4C9D0")

    private fun colorDia(fecha: String) = PlanillaReporte.COLOR_DIA[DatosReporte.indiceSemana(fecha)]

    private fun hex(c: String) = Color.parseColor("#$c")

    private fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
}

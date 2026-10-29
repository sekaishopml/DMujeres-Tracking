package com.dmujeres.app.reporte

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
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
 * El reporte en vistas del teléfono: resumen del período, días para elegir
 * (semana o mes) y la planilla del día elegido con los mismos datos y colores
 * que el Excel y el PDF.
 */
object VistaReporte {

    fun pintar(contenedor: LinearLayout, r: Reporte, elegido: String, alElegir: (String) -> Unit) {
        val ctx = contenedor.context
        contenedor.removeAllViews()
        if (r.periodo != Periodo.DIA) {
            contenedor.addView(resumen(ctx, r))
            contenedor.addView(selectorDias(ctx, r, elegido, alElegir))
        }
        val i = r.dias.indexOfFirst { it.fecha == elegido }.coerceAtLeast(0)
        val columna = PlanillaReporte.bloques(r).flatMap { it.columnas }[i]
        contenedor.addView(tarjetaDia(ctx, r.dias[i], columna))
    }

    // ── Resumen ─────────────────────────────────────────────────────────────

    private fun resumen(ctx: Context, r: Reporte): View {
        // Sin conexión no se sabe la jornada: "—", nunca un cero inventado.
        val conJornada = if (r.dias.any { it.jornadas == null }) "—" else r.dias.count { !it.jornadas.isNullOrEmpty() }.toString()
        val datos = listOf(
            conJornada to R.string.rep_res_jornada,
            r.dias.sumOf { it.actividades.size }.toString() to R.string.rep_res_actividades,
            r.dias.count { it.actividades.isNotEmpty() }.toString() to R.string.rep_res_dias_act,
        )
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.ds_hero)
            setPadding(0, dp(ctx, 12), 0, dp(ctx, 12))
            layoutParams = margenes(ctx, arriba = 0)
            datos.forEachIndexed { n, (valor, etiqueta) ->
                if (n > 0) addView(View(ctx).apply {
                    setBackgroundColor(ctx.getColor(R.color.line))
                    layoutParams = LinearLayout.LayoutParams(dp(ctx, 1), ViewGroup.LayoutParams.MATCH_PARENT)
                })
                addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    addView(texto(ctx, valor, 20f, R.color.navy, negrita = true).apply { gravity = Gravity.CENTER })
                    addView(texto(ctx, ctx.getString(etiqueta), 12f, R.color.text_secondary).apply { gravity = Gravity.CENTER })
                })
            }
        }
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
            val chip = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                background = redondo(ctx, if (si) ctx.getColor(R.color.navy) else hex(PlanillaReporte.tinte(color, 45)), 12)
                layoutParams = LinearLayout.LayoutParams(if (semana) 0 else dp(ctx, 50), dp(ctx, 66), if (semana) 1f else 0f)
                    .apply { marginEnd = dp(ctx, if (semana) 4 else 6) }
                contentDescription = dia.etiqueta
                val tinta = if (si) R.color.white else R.color.text_primary
                addView(texto(ctx, dia.etiqueta.take(3).uppercase(), 11f, tinta, negrita = true).apply { alpha = 0.8f; gravity = Gravity.CENTER })
                addView(texto(ctx, dia.fecha.substring(8), 17f, tinta, negrita = true).apply { gravity = Gravity.CENTER })
                // Punto: ese día tiene actividades registradas.
                addView(View(ctx).apply {
                    background = redondo(ctx, if (si) Color.WHITE else ctx.getColor(R.color.navy_700), 3)
                    visibility = if (dia.actividades.isEmpty()) View.INVISIBLE else View.VISIBLE
                    layoutParams = LinearLayout.LayoutParams(dp(ctx, 5), dp(ctx, 5)).apply { topMargin = dp(ctx, 4) }
                })
                setOnClickListener { if (!si) alElegir(dia.fecha) }
            }
            Animaciones.respuestaAlToque(chip)
            if (si) marcado = chip
            fila.addView(chip)
        }
        if (semana) return fila.apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(ctx, 12) }
        }
        return HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(ctx, 12) }
            addView(fila)
            // El día elegido queda a la vista (en el mes puede estar lejos).
            marcado?.let { m -> post { scrollTo((m.left - (width - m.width) / 2).coerceAtLeast(0), 0) } }
        }
    }

    // ── Planilla del día ────────────────────────────────────────────────────

    private fun tarjetaDia(ctx: Context, dia: DiaReporte, columna: PlanillaReporte.Columna): View {
        val color = colorDia(dia.fecha)
        val suave = hex(PlanillaReporte.tinte(color, 30))
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.ds_hero)
            clipToOutline = true
            layoutParams = margenes(ctx, arriba = 12)

            addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                // Esquinas de arriba como la tarjeta: el recorte por contorno no llega a todos los teléfonos.
                val r = dp(ctx, 22).toFloat()
                background = GradientDrawable().apply {
                    setColor(hex(color))
                    cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
                }
                setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
                addView(texto(ctx, dia.etiqueta, 16f, R.color.text_primary, negrita = true).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
                val n = dia.actividades.size
                addView(texto(ctx, ctx.resources.getQuantityString(R.plurals.rep_n_actividades, n, n), 13f, R.color.text_secondary))
            })

            addView(fila(ctx, null).apply {
                setPadding(dp(ctx, 16), dp(ctx, 8), dp(ctx, 16), dp(ctx, 8))
                addView(columnaHora(ctx).apply { addView(texto(ctx, ctx.getString(R.string.rep_col_hora), 11f, R.color.text_tertiary, negrita = true)) })
                addView(texto(ctx, ctx.getString(R.string.rep_col_plan), 11f, R.color.text_tertiary, negrita = true))
            })
            addView(linea(ctx))

            // Inicio arriba y fin abajo, tal como los arma la planilla.
            val inicio = columna.filas.first()
            addView(filaJornada(ctx, suave, inicio.hora, inicio.plan, null))
            addView(linea(ctx))

            if (dia.actividades.isEmpty()) {
                addView(texto(ctx, ctx.getString(R.string.rep_sin_actividades), 13f, R.color.text_secondary).apply {
                    setPadding(dp(ctx, 16), dp(ctx, 18), dp(ctx, 16), dp(ctx, 18))
                    gravity = Gravity.CENTER
                })
                addView(linea(ctx))
            }
            dia.actividades.forEach { a ->
                addView(filaActividad(ctx, a))
                addView(linea(ctx))
            }

            val fin = columna.filas.last()
            if (fin.hora.isNotBlank() || fin.plan.isNotBlank()) {
                val partes = fin.plan.ifBlank { ctx.getString(R.string.rep_fin_jornada) }.split(": ", limit = 2)
                addView(filaJornada(ctx, suave, fin.hora, partes[0], partes.getOrNull(1)))
            } else {
                removeViewAt(childCount - 1)
            }
        }
    }

    private fun filaJornada(ctx: Context, @ColorInt fondo: Int, hora: String, titulo: String, motivo: String?) =
        fila(ctx, fondo).apply {
            addView(columnaHora(ctx).apply { addView(texto(ctx, hora, 15f, R.color.text_primary, negrita = true)) })
            addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                addView(texto(ctx, titulo, 15f, R.color.text_primary, negrita = true))
                motivo?.let { addView(texto(ctx, it, 13f, R.color.text_secondary).apply { setPadding(0, dp(ctx, 2), 0, 0) }) }
            })
        }

    private fun filaActividad(ctx: Context, a: FilaActividad) = fila(ctx, null).apply {
        addView(columnaHora(ctx).apply {
            addView(texto(ctx, a.hora, 15f, R.color.text_primary, negrita = true))
            a.horaFin?.let { addView(texto(ctx, ctx.getString(R.string.rep_hasta_fmt, it), 12f, R.color.text_secondary)) }
        })
        val lugar = a.lugar?.takeIf { it.isNotBlank() }
        val detalle = listOfNotNull(a.tipo.takeIf { lugar != null }, a.nota?.takeIf { it.isNotBlank() }).joinToString(" · ")
        addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(texto(ctx, lugar ?: a.tipo, 15f, R.color.text_primary, negrita = true))
            if (detalle.isNotEmpty()) addView(texto(ctx, detalle, 13f, R.color.text_secondary).apply { setPadding(0, dp(ctx, 2), 0, 0) })
        })
    }

    // ── Piezas ──────────────────────────────────────────────────────────────

    private fun fila(ctx: Context, @ColorInt fondo: Int?) = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        fondo?.let { setBackgroundColor(it) }
        setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
    }

    private fun columnaHora(ctx: Context) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(dp(ctx, 84), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun linea(ctx: Context) = View(ctx).apply {
        setBackgroundColor(ctx.getColor(R.color.line))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(ctx, 1))
    }

    private fun texto(ctx: Context, s: String, sp: Float, color: Int, negrita: Boolean = false) = TextView(ctx).apply {
        text = s
        textSize = sp
        setTextColor(ctx.getColor(color))
        if (negrita) setTypeface(typeface, Typeface.BOLD)
    }

    private fun margenes(ctx: Context, arriba: Int) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(ctx, 16), dp(ctx, arriba), dp(ctx, 16), 0)
        }

    private fun redondo(ctx: Context, @ColorInt color: Int, radio: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(ctx, radio).toFloat()
    }

    private fun colorDia(fecha: String) = PlanillaReporte.COLOR_DIA[DatosReporte.indiceSemana(fecha)]

    private fun hex(c: String) = Color.parseColor("#$c")

    private fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
}

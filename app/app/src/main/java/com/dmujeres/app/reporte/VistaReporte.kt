package com.dmujeres.app.reporte

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.dmujeres.app.R

/**
 * El reporte como pantalla: la misma vista sirve para verlo en la app y para
 * la imagen (PNG) que se descarga o se manda por correo.
 */
object VistaReporte {

    fun crear(context: Context, r: Reporte): LinearLayout {
        val d = context.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        fun texto(t: String, sp: Float, color: Int, negrita: Boolean = false) = TextView(context).apply {
            text = t
            textSize = sp
            setTextColor(context.getColor(color))
            if (negrita) setTypeface(typeface, Typeface.BOLD)
        }
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            addView(texto("${r.titulo} · ${r.nombre}", 19f, R.color.navy_700, negrita = true))
            addView(texto(r.rango, 13f, R.color.text_secondary).apply { setPadding(0, dp(2), 0, dp(10)) })
            for (dia in r.dias) {
                addView(texto("${dia.etiqueta} · Jornada ${DatosReporte.textoJornada(dia.jornadas)}", 14f, R.color.navy_700, negrita = true).apply {
                    setBackgroundResource(R.drawable.ds_sugerencia)
                    setPadding(dp(10), dp(7), dp(10), dp(7))
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                        .apply { topMargin = dp(8) }
                })
                dia.jornadas.orEmpty().mapNotNull { it.notaFin }.forEach {
                    addView(texto("Motivo de cierre: $it", 13f, R.color.primary_dark).apply { setPadding(dp(10), dp(4), dp(10), 0) })
                }
                if (dia.actividades.isEmpty()) {
                    addView(texto("Sin actividades", 13.5f, R.color.text_secondary).apply { setPadding(dp(10), dp(6), dp(10), dp(2)) })
                }
                for (a in dia.actividades) {
                    val horas = if (a.horaFin != null) "${a.hora} – ${a.horaFin}" else "${a.hora} · en curso"
                    addView(texto("$horas   ${a.tipo}${a.lugar?.let { " · $it" }.orEmpty()}", 14f, R.color.text_primary).apply {
                        setPadding(dp(10), dp(6), dp(10), 0)
                    })
                    a.nota?.takeIf { it.isNotBlank() }?.let {
                        addView(texto("“$it”", 13f, R.color.text_secondary).apply { setPadding(dp(10), dp(1), dp(10), 0) })
                    }
                }
            }
        }
    }

    /** La imagen del reporte, a [anchoPx] de ancho (tope de alto para un mes largo). */
    fun imagen(context: Context, r: Reporte, anchoPx: Int = 1080): Bitmap {
        val vista = crear(context, r)
        vista.measure(
            View.MeasureSpec.makeMeasureSpec(anchoPx, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        val alto = vista.measuredHeight.coerceIn(1, 30_000)
        vista.layout(0, 0, anchoPx, alto)
        return Bitmap.createBitmap(anchoPx, alto, Bitmap.Config.ARGB_8888).also { vista.draw(Canvas(it)) }
    }
}

package com.dmujeres.app.reporte

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint

/**
 * El reporte como imagen (PNG), dibujado con la misma planilla que el Excel:
 * columnas por día con su color, HORA | PLANIFICACIÓN, inicio, actividades y
 * fin. Una sola letra; negrita solo en los encabezados. También es lo que se
 * ve en la app.
 */
object ImagenReporte {

    private const val HORA = 170
    private const val PLAN = 340
    private const val MARGEN = 24
    private const val RELLENO = 10
    private const val LETRA = 24f
    private const val MAX_ALTO = 30_000

    fun bitmap(r: Reporte): Bitmap {
        val normal = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = LETRA; color = Color.rgb(23, 28, 36) }
        val negrita = TextPaint(normal).apply { typeface = Typeface.DEFAULT_BOLD }
        val bloques = PlanillaReporte.bloques(r)
        val anchoTabla = (HORA + PLAN) * bloques.maxOf { it.columnas.size }
        val ancho = anchoTabla + 2 * MARGEN

        // El constructor viejo funciona desde Android 5 (el Builder pide 6).
        @Suppress("DEPRECATION")
        fun texto(t: String, w: Int, p: TextPaint, centro: Boolean = false): StaticLayout = StaticLayout(
            t, p, (w - 2 * RELLENO).coerceAtLeast(1),
            if (centro) Layout.Alignment.ALIGN_CENTER else Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false,
        )

        // Primero se mide el alto de cada fila; después se dibuja.
        data class Fila(val celdas: List<Triple<StaticLayout, Int, String?>>, val alto: Int)
        val titulo = texto("${r.titulo} · ${r.nombre} · ${r.rango}", anchoTabla, negrita)
        val porBloque = bloques.map { b ->
            val filas = mutableListOf<Fila>()
            fun agregar(celdas: List<Triple<StaticLayout, Int, String?>>) {
                filas += Fila(celdas, celdas.maxOf { it.first.height } + 2 * RELLENO)
            }
            agregar(b.columnas.map { Triple(texto(it.titulo, HORA + PLAN, negrita, centro = true), HORA + PLAN, PlanillaReporte.tinte(it.color, 70)) })
            agregar(b.columnas.flatMap {
                listOf(
                    Triple(texto("HORA", HORA, negrita, centro = true), HORA, PlanillaReporte.tinte(it.color, 45)),
                    Triple(texto("PLANIFICACIÓN", PLAN, negrita, centro = true), PLAN, PlanillaReporte.tinte(it.color, 25)),
                )
            })
            for (i in 0 until b.filas) {
                val jornada = i == 0 || i == b.filas - 1
                agregar(b.columnas.flatMap {
                    val c = it.filas[i]
                    listOf(
                        Triple(texto(c.hora, HORA, normal, centro = true), HORA, PlanillaReporte.tinte(it.color, 40)),
                        Triple(texto(c.plan, PLAN, normal), PLAN, if (jornada) PlanillaReporte.tinte(it.color, 12) else null),
                    )
                })
            }
            filas
        }
        val alto = (MARGEN + titulo.height + porBloque.sumOf { f -> MARGEN + f.sumOf { it.alto } } + MARGEN).coerceAtMost(MAX_ALTO)
        val bmp = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp).apply { drawColor(Color.WHITE) }
        val fondo = Paint()
        val borde = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 1.5f; color = Color.rgb(191, 199, 211) }

        var y = MARGEN.toFloat()
        canvas.save(); canvas.translate(MARGEN.toFloat(), y); titulo.draw(canvas); canvas.restore()
        y += titulo.height
        for (filas in porBloque) {
            y += MARGEN
            for (fila in filas) {
                var x = MARGEN.toFloat()
                for ((layout, w, color) in fila.celdas) {
                    if (color != null) {
                        fondo.color = Color.parseColor("#$color")
                        canvas.drawRect(x, y, x + w, y + fila.alto, fondo)
                    }
                    canvas.drawRect(x, y, x + w, y + fila.alto, borde)
                    canvas.save(); canvas.translate(x + RELLENO, y + RELLENO); layout.draw(canvas); canvas.restore()
                    x += w
                }
                y += fila.alto
            }
        }
        return bmp
    }
}

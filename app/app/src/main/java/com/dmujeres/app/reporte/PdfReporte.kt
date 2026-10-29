package com.dmujeres.app.reporte

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import java.io.ByteArrayOutputStream

/**
 * El reporte en PDF (A4 horizontal), con texto vectorial: se ve nítido en
 * el correo y al imprimir (la imagen PNG se veía borrosa). Arriba el membrete
 * (nombre de la empresa, el reporte, la persona y el período), la planilla
 * del panel (columnas por día) y el pie con la página. Una semana por página; si no cabe, sigue en la siguiente con
 * los encabezados repetidos. Una sola letra; negrita solo en encabezados.
 */
object PdfReporte {

    const val ANCHO = 842
    const val ALTO = 595
    private const val MARGEN = 28f
    private const val MEMBRETE = 58f
    private const val LETRA = 7.6f
    private const val RELLENO = 3.5f
    private val AZUL = Color.rgb(23, 54, 93)
    // Magenta de la marca para el nombre de arriba.
    private val MAGENTA = Color.rgb(235, 0, 69)
    private val TINTA = Color.rgb(23, 28, 36)
    private val GRIS = Color.rgb(95, 107, 122)
    private val LINEA = Color.rgb(166, 166, 166)

    fun bytes(r: Reporte, generado: String): ByteArray {
        val doc = PdfDocument()
        var pagina: PdfDocument.Page? = null
        dibujar(r, generado, { numero ->
            doc.startPage(PdfDocument.PageInfo.Builder(ANCHO, ALTO, numero).create()).also { pagina = it }.canvas
        }) { doc.finishPage(pagina) }
        return ByteArrayOutputStream().also { doc.writeTo(it); doc.close() }.toByteArray()
    }

    /**
     * Dibuja las páginas: [abrir] da el lienzo de la página N y [terminar] la
     * cierra. Separado del PdfDocument para poder ver el dibujo en una prueba.
     */
    fun dibujar(r: Reporte, generado: String, abrir: (Int) -> Canvas, terminar: () -> Unit) {
        val normal = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = LETRA; color = TINTA; typeface = Typeface.SANS_SERIF }
        val negrita = TextPaint(normal).apply { typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        val bloques = PlanillaReporte.bloques(r)
        val anchoTabla = ANCHO - 2 * MARGEN
        var numero = 0
        var actual: Canvas? = null
        var y = 0f

        fun cerrar() {
            actual?.let {
                pie(it, numero, generado)
                terminar()
            }
        }
        fun nueva(): Canvas {
            cerrar()
            numero += 1
            val c = abrir(numero)
            actual = c
            cabecera(c, r)
            y = MARGEN + MEMBRETE
            return c
        }
        fun texto(t: String, w: Float, p: TextPaint, centro: Boolean = false): StaticLayout {
            @Suppress("DEPRECATION")
            return StaticLayout(
                t, p, (w - 2 * RELLENO).toInt().coerceAtLeast(1),
                if (centro) Layout.Alignment.ALIGN_CENTER else Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false,
            )
        }

        for (bloque in bloques) {
            val dias = bloque.columnas.size
            // Ancho por día: toda la página para una semana; un día solo no se estira de más.
            val anchoDia = minOf(anchoTabla / maxOf(dias, 1), anchoTabla / 3)
            val hora = anchoDia * 0.37f
            val plan = anchoDia - hora
            data class Celda(val layout: StaticLayout, val w: Float, val fondo: String?)
            fun fila(celdas: List<Celda>) = celdas to (celdas.maxOf { it.layout.height } + 2 * RELLENO)
            val encabezados = listOf(
                fila(bloque.columnas.map { Celda(texto(it.titulo, anchoDia, negrita, true), anchoDia, it.color) }),
                fila(bloque.columnas.flatMap {
                    listOf(
                        Celda(texto("HORA", hora, negrita, true), hora, PlanillaReporte.tinte(it.color, 45)),
                        Celda(texto("PLANIFICACIÓN", plan, negrita, true), plan, PlanillaReporte.tinte(it.color, 45)),
                    )
                }),
            )
            val cuerpo = (0 until bloque.filas).map { i ->
                val jornada = i == 0 || i == bloque.filas - 1
                fila(bloque.columnas.flatMap {
                    val c = it.filas[i]
                    listOf(
                        Celda(texto(c.hora, hora, normal, true), hora, PlanillaReporte.tinte(it.color, 30)),
                        Celda(texto(c.plan, plan, normal), plan, if (jornada) PlanillaReporte.tinte(it.color, 12) else null),
                    )
                })
            }
            val altoEncabezados = encabezados.sumOf { it.second.toDouble() }.toFloat()
            var canvas = actual.takeIf { y + altoEncabezados + (cuerpo.firstOrNull()?.second ?: 0f) <= ALTO - MARGEN - 20f } ?: nueva()
            fun dibujar(f: Pair<List<Celda>, Float>) {
                var x = MARGEN
                val fondo = Paint()
                val borde = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 0.5f; color = LINEA }
                for (c in f.first) {
                    if (c.fondo != null) {
                        fondo.color = Color.parseColor("#${c.fondo}")
                        canvas.drawRect(x, y, x + c.w, y + f.second, fondo)
                    }
                    canvas.drawRect(x, y, x + c.w, y + f.second, borde)
                    canvas.save(); canvas.translate(x + RELLENO, y + RELLENO); c.layout.draw(canvas); canvas.restore()
                    x += c.w
                }
                y += f.second
            }
            encabezados.forEach { dibujar(it) }
            for (f in cuerpo) {
                if (y + f.second > ALTO - MARGEN - 20f) {
                    canvas = nueva()
                    encabezados.forEach { dibujar(it) }
                }
                dibujar(f)
            }
            y += 16f
        }
        cerrar()
    }

    /** Membrete sencillo, como una hoja de la empresa: sin franjas de color, solo una línea marina. */
    private fun cabecera(c: Canvas, r: Reporte) {
        // Misma letra del reporte, sin negrita: solo cambia el color.
        val marca = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MAGENTA; textSize = 16f; typeface = Typeface.SANS_SERIF }
        val titulo = Paint(marca).apply { color = TINTA; textSize = 11f; textAlign = Paint.Align.RIGHT; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        val etiqueta = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GRIS; textSize = 8.5f; typeface = Typeface.SANS_SERIF }
        val dato = Paint(etiqueta).apply { color = TINTA }
        c.drawText("DMujeres Tracking", MARGEN, MARGEN + 10f, marca)
        c.drawText(r.titulo, ANCHO - MARGEN, MARGEN + 10f, titulo)
        c.drawRect(MARGEN, MARGEN + 17f, ANCHO - MARGEN, MARGEN + 18f, Paint().apply { color = AZUL })
        var x = MARGEN
        for ((k, v) in listOf("Nombre:" to r.nombre, "Período:" to r.rango.replaceFirstChar { it.lowercase() })) {
            c.drawText(k, x, MARGEN + 33f, etiqueta)
            x += etiqueta.measureText(k) + 4f
            c.drawText(v, x, MARGEN + 33f, dato)
            x += dato.measureText(v) + 28f
        }
    }

    private fun pie(c: Canvas, numero: Int, generado: String) {
        val gris = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GRIS; textSize = 7.5f; typeface = Typeface.SANS_SERIF }
        c.drawText("Generado el $generado", MARGEN, ALTO - MARGEN + 13f, gris)
        c.drawText("Página $numero", ANCHO - MARGEN, ALTO - MARGEN + 13f, Paint(gris).apply { textAlign = Paint.Align.RIGHT })
    }
}

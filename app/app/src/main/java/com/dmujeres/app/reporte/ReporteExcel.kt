package com.dmujeres.app.reporte

import com.dmujeres.app.reporte.PlanillaReporte.tinte
import com.dmujeres.app.reporte.Xlsx.Celda
import com.dmujeres.app.reporte.Xlsx.Estilo
import java.io.ByteArrayOutputStream

/**
 * El reporte en Excel con la forma de la planilla del panel: por cada semana
 * una fila con los días (combinados de a dos columnas, con su color), HORA |
 * PLANIFICACIÓN, el inicio de jornada, las actividades y el fin. Una sola
 * letra en todo; solo los encabezados en negrita.
 */
object ReporteExcel {

    private const val ANCHO_HORA = 13.0
    private const val ANCHO_PLAN = 30.0

    fun bytes(r: Reporte, generado: String): ByteArray {
        val bloques = PlanillaReporte.bloques(r)
        val columnas = 2 * bloques.maxOf { it.columnas.size }
        val filas = mutableListOf<List<Celda>>()
        val combinadas = mutableListOf<String>()
        fun combinar(fila: Int, desde: Int, hasta: Int) {
            combinadas += "${Xlsx.columna(desde)}$fila:${Xlsx.columna(hasta)}$fila"
        }
        filas += listOf(Celda("${r.titulo} · ${r.nombre} · ${r.rango} · generado el $generado", Estilo(negrita = true, borde = false)))
        combinar(1, 0, columnas - 1)
        for (bloque in bloques) {
            filas += emptyList<Celda>()
            filas += bloque.columnas.flatMap { c ->
                listOf(Celda(c.titulo, Estilo(negrita = true, relleno = tinte(c.color, 70), centrado = true)), Celda("", Estilo(relleno = tinte(c.color, 70))))
            }
            bloque.columnas.indices.forEach { combinar(filas.size, 2 * it, 2 * it + 1) }
            filas += bloque.columnas.flatMap { c ->
                listOf(
                    Celda("HORA", Estilo(negrita = true, relleno = tinte(c.color, 45), centrado = true)),
                    Celda("PLANIFICACIÓN", Estilo(negrita = true, relleno = tinte(c.color, 25), centrado = true)),
                )
            }
            for (i in 0 until bloque.filas) {
                // Inicio y fin de jornada (primera y última fila) con un fondo suave.
                val jornada = i == 0 || i == bloque.filas - 1
                filas += bloque.columnas.flatMap { c ->
                    val celda = c.filas[i]
                    listOf(
                        Celda(celda.hora, Estilo(relleno = tinte(c.color, 40), centrado = true)),
                        Celda(celda.plan, Estilo(relleno = if (jornada) tinte(c.color, 12) else null)),
                    )
                }
            }
        }
        val salida = ByteArrayOutputStream()
        Xlsx.escribir(salida, r.titulo, filas, List(columnas) { if (it % 2 == 0) ANCHO_HORA else ANCHO_PLAN }, combinadas)
        return salida.toByteArray()
    }
}

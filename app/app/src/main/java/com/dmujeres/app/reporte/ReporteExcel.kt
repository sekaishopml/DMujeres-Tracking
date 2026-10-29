package com.dmujeres.app.reporte

import com.dmujeres.app.reporte.Xlsx.Celda
import com.dmujeres.app.reporte.Xlsx.Estilo
import java.io.ByteArrayOutputStream

/**
 * El reporte en Excel: título, período, y una fila por actividad con su día
 * y la jornada (inicio y fin, y el motivo si cerró en horario laboral). Un
 * día sin actividades queda igual en la tabla, para que se vea.
 */
object ReporteExcel {

    private val ENCABEZADOS = listOf("Fecha", "Día", "Jornada", "Inicio", "Fin", "Tipo", "Lugar", "Nota")
    private val ANCHOS = listOf(12.0, 12.0, 24.0, 8.0, 8.0, 14.0, 32.0, 40.0)

    fun bytes(r: Reporte, generado: String): ByteArray {
        val ultima = Xlsx.columna(ENCABEZADOS.size - 1)
        val filas = mutableListOf(
            listOf(Celda("${r.titulo} · ${r.nombre}", Estilo.TITULO)),
            listOf(Celda("${r.rango} · generado el $generado", Estilo.SUBTITULO)),
            emptyList(),
            ENCABEZADOS.map { Celda(it, Estilo.ENCABEZADO) },
        )
        for (dia in r.dias) {
            val fecha = DatosReporte.corta(dia.fecha)
            val nombreDia = dia.etiqueta.substringBefore(' ')
            val jornada = DatosReporte.textoJornada(dia.jornadas) +
                dia.jornadas.orEmpty().mapNotNull { it.notaFin }.joinToString("") { " (motivo de cierre: $it)" }
            if (dia.actividades.isEmpty()) {
                filas += listOf(
                    Celda(fecha, Estilo.DIA), Celda(nombreDia, Estilo.DIA), Celda(jornada),
                    Celda("—"), Celda(""), Celda(""), Celda("Sin actividades"), Celda(""),
                )
                continue
            }
            dia.actividades.forEachIndexed { i, a ->
                filas += listOf(
                    Celda(fecha, Estilo.DIA), Celda(nombreDia, Estilo.DIA),
                    Celda(if (i == 0) jornada else ""),
                    Celda(a.hora), Celda(a.horaFin ?: "—"), Celda(a.tipo),
                    Celda(a.lugar ?: "—"), Celda(a.nota.orEmpty()),
                )
            }
        }
        val salida = ByteArrayOutputStream()
        Xlsx.escribir(
            salida, r.titulo, filas, ANCHOS,
            combinadas = listOf("A1:${ultima}1", "A2:${ultima}2"),
            filaEncabezado = 4,
        )
        return salida.toByteArray()
    }
}

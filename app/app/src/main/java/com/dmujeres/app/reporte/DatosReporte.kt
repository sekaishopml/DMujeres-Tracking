package com.dmujeres.app.reporte

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/** Diario, semanal (lunes a domingo) o mensual. */
enum class Periodo(val etiqueta: String) { DIA("diario"), SEMANA("semanal"), MES("mensual") }

data class FilaActividad(val hora: String, val horaFin: String?, val tipo: String, val lugar: String?, val nota: String?)

/** Inicio y fin de jornada como los guarda el servidor (fin null si sigue abierta). */
data class JornadaDia(val inicio: String, val fin: String?, val abierta: Boolean, val notaFin: String?)

data class DiaReporte(
    val fecha: String,
    val etiqueta: String,
    /** null: sin conexión, no se sabe (se muestra "—", nunca se inventa). */
    val jornadas: List<JornadaDia>?,
    val actividades: List<FilaActividad>,
)

data class Reporte(val periodo: Periodo, val nombre: String, val desde: String, val hasta: String, val dias: List<DiaReporte>) {
    val titulo: String get() = "Reporte ${periodo.etiqueta}"

    /** "Martes 28/10/2026" o "Del 27/10/2026 al 02/11/2026". */
    val rango: String get() = if (desde == hasta) {
        "${DatosReporte.etiquetaDia(desde)}/${desde.substring(0, 4)}"
    } else {
        "Del ${DatosReporte.corta(desde)} al ${DatosReporte.corta(hasta)}"
    }

    /** Sin caracteres raros: sirve de nombre de archivo y de adjunto. */
    val nombreArchivo: String get() =
        "Reporte ${periodo.etiqueta} ${nombre.replace(Regex("[^\\p{L}\\p{N} ]"), "").trim()} $desde".replace(Regex("\\s+"), " ").trim()
}

/** Arma el reporte con lo que tiene la app y las jornadas del servidor (sin Android, se prueba). */
object DatosReporte {

    private val zona: TimeZone = TimeZone.getTimeZone("America/Guayaquil")
    private val DIAS = arrayOf("Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado")

    private fun formato(patron: String) = SimpleDateFormat(patron, Locale.US).apply { timeZone = zona; isLenient = false }

    private fun calendario(fecha: String): Calendar =
        Calendar.getInstance(zona).apply { time = formato("yyyy-MM-dd").parse(fecha)!! }

    private fun texto(c: Calendar): String = formato("yyyy-MM-dd").format(c.time)

    /** Primer y último día del período que contiene [fecha]. */
    fun rango(periodo: Periodo, fecha: String): Pair<String, String> {
        val c = calendario(fecha)
        return when (periodo) {
            Periodo.DIA -> fecha to fecha
            Periodo.SEMANA -> {
                val atras = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7
                c.add(Calendar.DAY_OF_MONTH, -atras)
                val lunes = texto(c)
                c.add(Calendar.DAY_OF_MONTH, 6)
                lunes to texto(c)
            }
            Periodo.MES -> {
                c.set(Calendar.DAY_OF_MONTH, 1)
                val primero = texto(c)
                c.set(Calendar.DAY_OF_MONTH, c.getActualMaximum(Calendar.DAY_OF_MONTH))
                primero to texto(c)
            }
        }
    }

    /** El mismo período, [paso] veces antes o después. */
    fun mover(periodo: Periodo, fecha: String, paso: Int): String {
        val c = calendario(fecha)
        when (periodo) {
            Periodo.DIA -> c.add(Calendar.DAY_OF_MONTH, paso)
            Periodo.SEMANA -> c.add(Calendar.DAY_OF_MONTH, 7 * paso)
            Periodo.MES -> { c.set(Calendar.DAY_OF_MONTH, 1); c.add(Calendar.MONTH, paso) }
        }
        return texto(c)
    }

    fun dias(desde: String, hasta: String): List<String> {
        val c = calendario(desde)
        return buildList {
            while (texto(c) <= hasta) {
                add(texto(c))
                c.add(Calendar.DAY_OF_MONTH, 1)
            }
        }
    }

    /** "Lunes 27/10". */
    fun etiquetaDia(fecha: String): String {
        val c = calendario(fecha)
        return "${DIAS[c.get(Calendar.DAY_OF_WEEK) - 1]} ${formato("dd/MM").format(c.time)}"
    }

    /** "27/10/2026". */
    fun corta(fecha: String): String = formato("dd/MM/yyyy").format(calendario(fecha).time)

    /** "08:01 a 17:05", "08:01 · en curso" o "Sin jornada"; "—" si no se sabe. */
    fun textoJornada(jornadas: List<JornadaDia>?): String = when {
        jornadas == null -> "—"
        jornadas.isEmpty() -> "Sin jornada"
        else -> jornadas.joinToString(" · ") { j ->
            if (j.abierta || j.fin == null) "${j.inicio} · en curso" else "${j.inicio} a ${j.fin}"
        }
    }

    fun armar(
        periodo: Periodo,
        fecha: String,
        nombre: String,
        actividadesDe: (String) -> List<FilaActividad>,
        jornadas: Map<String, List<JornadaDia>>?,
    ): Reporte {
        val (desde, hasta) = rango(periodo, fecha)
        val dias = dias(desde, hasta).map { f ->
            DiaReporte(f, etiquetaDia(f), jornadas?.let { it[f] ?: emptyList() }, actividadesDe(f).sortedBy { it.hora })
        }
        return Reporte(periodo, nombre, desde, hasta, dias)
    }
}

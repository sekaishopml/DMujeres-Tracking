package com.dmujeres.app.reporte

/**
 * El reporte con la forma de la planilla del panel (Reportes → Cronograma):
 * una columna por día (HORA | PLANIFICACIÓN) con el color de ese día, arriba
 * el inicio de jornada, las actividades en orden y abajo el fin. El mes es una
 * semana debajo de otra. El Excel y la imagen salen de aquí (sin Android).
 */
object PlanillaReporte {

    /** Colores de día del panel (lunes salmón, martes azul, …). */
    val COLOR_DIA = listOf("F4B183", "9DC3E6", "C5E0B4", "FFE699", "C9CDEA", "D9D9D9", "E7E6E6")

    data class Celda(val hora: String, val plan: String)

    data class Columna(val titulo: String, val color: String, val filas: List<Celda>)

    /** Una semana (o un solo día): todas sus columnas tienen el mismo número de filas. */
    data class Bloque(val columnas: List<Columna>) {
        val filas: Int get() = columnas.maxOf { it.filas.size }
    }

    /** Mezcla [color] con blanco: [pct] es cuánto del color queda (como el panel). */
    fun tinte(color: String, pct: Int): String {
        val c = color.chunked(2).map { it.toInt(16) }
        return c.joinToString("") { "%02X".format((it * pct + 255 * (100 - pct)) / 100) }
    }

    fun bloques(r: Reporte): List<Bloque> {
        val semanas = mutableListOf<MutableList<DiaReporte>>()
        for (dia in r.dias) {
            if (semanas.isEmpty() || DatosReporte.indiceSemana(dia.fecha) == 0) semanas += mutableListOf<DiaReporte>()
            semanas.last() += dia
        }
        return semanas.map { semana ->
            val columnas = semana.map { columna(it) }
            val alto = columnas.maxOf { it.filas.size }
            // El fin de jornada queda siempre en la última fila, como en el panel.
            Bloque(columnas.map { c ->
                val relleno = List(alto - c.filas.size) { Celda("", "") }
                c.copy(filas = c.filas.dropLast(1) + relleno + c.filas.last())
            })
        }
    }

    private fun columna(dia: DiaReporte): Columna {
        val j = dia.jornadas
        val inicio = when {
            j == null -> Celda("—", "Inicio de jornada")
            j.isEmpty() -> Celda("", "Sin jornada")
            else -> Celda(j.joinToString(" · ") { it.inicio }, "Inicio de jornada")
        }
        val fin = when {
            j.isNullOrEmpty() -> Celda(if (j == null) "—" else "", "")
            else -> Celda(
                j.joinToString(" · ") { if (it.abierta || it.fin == null) "en curso" else it.fin },
                "Fin de jornada" + j.mapNotNull { it.notaFin }.joinToString("") { ": $it" },
            )
        }
        val actividades = dia.actividades.map { a ->
            Celda(
                if (a.horaFin != null) "${a.hora} a ${a.horaFin}" else a.hora,
                listOfNotNull(
                    a.tipo.takeIf { it != "Visita" || a.lugar == null },
                    a.lugar,
                    a.nota?.takeIf { it.isNotBlank() },
                ).joinToString(" · "),
            )
        }
        val titulo = dia.etiqueta
        return Columna(titulo, COLOR_DIA[DatosReporte.indiceSemana(dia.fecha)], listOf(inicio) + actividades + fin)
    }
}

package com.dmujeres.app.avisos

import com.dmujeres.app.cronograma.TipoActividad

/**
 * Qué se le avisa a la persona y cuándo. Sin Android, para poder probarlo.
 *
 * Solo de lunes a sábado, a las 07:30, 08:15, 12:00 y 15:00 (nunca de noche
 * ni en la tarde): un aviso corto con lo que haga falta.
 *  - 07:30, 08:15 y 15:00: si todavía no inició la jornada. La de las 08:15
 *    es solo ese recordatorio (el servidor la manda únicamente a los que no
 *    mandaron puntos desde las 08:00).
 *  - 07:30, 12:00 y 15:00: si tiene un permiso quitado (ubicación apagada,
 *    sin permiso de ubicación o sin "todo el tiempo", batería restringida) y
 *    si hay que actualizar la app.
 *  - Con vacaciones, un permiso o una novedad anotados hoy no se avisa nada:
 *    la persona ya dijo que no está en ruta. Almuerzo y visita no cambian nada.
 */
object AvisosHorarios {

    enum class Novedad { SIN_JORNADA, PERMISO_QUITADO, ACTUALIZAR }

    /** Minutos del día en que se avisa. */
    val FRANJAS = listOf(7 * 60 + 30, 8 * 60 + 15, 12 * 60, 15 * 60)
    private val SOLO_JORNADA = 8 * 60 + 15
    private val DE_JORNADA = setOf(7 * 60 + 30, SOLO_JORNADA, 15 * 60)

    /** Tipos que significan "hoy no estoy en ruta". */
    val SILENCIAN = setOf(
        TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.NOVEDAD,
    )

    data class Estado(
        val jornadaAbierta: Boolean,
        val gpsEncendido: Boolean,
        val permisoUbicacion: Boolean,
        val permisoTodoElTiempo: Boolean,
        val bateriaRestringida: Boolean,
        val hayActualizacion: Boolean,
        val tiposDeHoy: Set<TipoActividad>,
    )

    fun novedades(franja: Int, e: Estado): List<Novedad> {
        if (e.tiposDeHoy.any { it in SILENCIAN }) return emptyList()
        return buildList {
            if (!e.jornadaAbierta && franja in DE_JORNADA) add(Novedad.SIN_JORNADA)
            if (franja == SOLO_JORNADA) return@buildList
            if (!e.gpsEncendido || !e.permisoUbicacion || !e.permisoTodoElTiempo || e.bateriaRestringida) add(Novedad.PERMISO_QUITADO)
            if (e.hayActualizacion) add(Novedad.ACTUALIZAR)
        }
    }

    /** Lunes a sábado, con los días de [java.util.Calendar] (domingo = 1, sábado = 7). */
    fun diaHabil(diaSemana: Int): Boolean = diaSemana in 2..7

    /**
     * Franja que toca atender a esta hora: la última que ya pasó, si no pasó
     * hace más de [tolerancia] minutos (la alarma del teléfono puede atrasarse).
     */
    fun franjaVigente(minutoAhora: Int, tolerancia: Int = 45): Int? =
        FRANJAS.lastOrNull { it <= minutoAhora && minutoAhora - it <= tolerancia }

    /** Minutos que faltan para la próxima franja de un día hábil. */
    fun minutosHastaLaProxima(minutoAhora: Int, diaSemana: Int): Int {
        for (dias in 0..7) {
            val dia = (diaSemana - 1 + dias) % 7 + 1
            if (!diaHabil(dia)) continue
            val franja = FRANJAS.firstOrNull { dias > 0 || it > minutoAhora } ?: continue
            return dias * 24 * 60 + franja - minutoAhora
        }
        return 24 * 60
    }
}

package com.dmujeres.app.avisos

import com.dmujeres.app.cronograma.TipoActividad

/**
 * Qué se le avisa a la persona a ciertas horas del día. Sin Android, para
 * poder probarlo.
 *
 *  - 08:00, 14:00 y 17:00: si hay jornada, lo que impide registrar bien la
 *    ruta (sin conexión, señal débil, GPS, permisos, batería).
 *  - 08:00 y 15:00: si todavía no inició la jornada.
 *  - Con vacaciones, un permiso o una novedad anotados hoy no se avisa nada:
 *    la persona ya dijo que no está en ruta. Almuerzo y visita no cambian nada.
 */
object AvisosHorarios {

    enum class Novedad {
        SIN_JORNADA, SIN_CONEXION, SENAL_DEBIL, GPS_APAGADO, SIN_PERMISO,
        SIN_TODO_EL_TIEMPO, BATERIA_RESTRINGIDA, AHORRO_BATERIA,
    }

    /** Minutos del día en que se revisa. */
    val FRANJAS = listOf(8 * 60, 14 * 60, 15 * 60, 17 * 60)
    private val DE_JORNADA = setOf(8 * 60, 15 * 60)
    private val DE_NOVEDADES = setOf(8 * 60, 14 * 60, 17 * 60)

    /** Tipos que significan "hoy no estoy en ruta". */
    val SILENCIAN = setOf(
        TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.NOVEDAD,
    )

    /** Con esta cola o más sin enviar teniendo red, la señal es débil. */
    const val PENDIENTES_SENAL_DEBIL = 30

    data class Estado(
        val jornadaAbierta: Boolean,
        val hayRed: Boolean,
        val servidorFalla: Boolean,
        val pendientes: Int,
        val gpsEncendido: Boolean,
        val permisoUbicacion: Boolean,
        val permisoTodoElTiempo: Boolean,
        val bateriaRestringida: Boolean,
        val ahorroDeBateria: Boolean,
        val tiposDeHoy: Set<TipoActividad>,
    )

    fun novedades(franja: Int, e: Estado): List<Novedad> {
        if (e.tiposDeHoy.any { it in SILENCIAN }) return emptyList()
        if (!e.jornadaAbierta) return if (franja in DE_JORNADA) listOf(Novedad.SIN_JORNADA) else emptyList()
        if (franja !in DE_NOVEDADES) return emptyList()
        return buildList {
            if (!e.gpsEncendido) add(Novedad.GPS_APAGADO)
            if (!e.permisoUbicacion) add(Novedad.SIN_PERMISO) else if (!e.permisoTodoElTiempo) add(Novedad.SIN_TODO_EL_TIEMPO)
            if (e.bateriaRestringida) add(Novedad.BATERIA_RESTRINGIDA)
            if (e.ahorroDeBateria) add(Novedad.AHORRO_BATERIA)
            if (!e.hayRed || e.servidorFalla) add(Novedad.SIN_CONEXION)
            else if (e.pendientes >= PENDIENTES_SENAL_DEBIL) add(Novedad.SENAL_DEBIL)
        }
    }

    /**
     * Franja que toca atender a esta hora: la última que ya pasó, si no pasó
     * hace más de [tolerancia] minutos (la alarma del teléfono puede atrasarse).
     */
    fun franjaVigente(minutoAhora: Int, tolerancia: Int = 45): Int? =
        FRANJAS.lastOrNull { it <= minutoAhora && minutoAhora - it <= tolerancia }

    /** Minutos que faltan para la próxima franja (hoy o mañana). */
    fun minutosHastaLaProxima(minutoAhora: Int): Int =
        (FRANJAS.firstOrNull { it > minutoAhora } ?: (FRANJAS.first() + 24 * 60)) - minutoAhora
}

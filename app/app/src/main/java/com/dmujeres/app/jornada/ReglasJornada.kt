package com.dmujeres.app.jornada

import com.dmujeres.app.cronograma.TipoActividad

/**
 * Reglas de la jornada que no dependen de Android (se prueban en
 * ReglasJornadaTest):
 *  - de 07:00 a 17:00 no se cierra sin escribir por qué;
 *  - al iniciar una visita o un almuerzo sin jornada, la jornada empieza;
 *  - con una visita o un almuerzo en el cronograma, la jornada empieza sola
 *    1 h antes de la primera del día.
 */
object ReglasJornada {

    const val DESDE_NOTA = 7 * 60
    const val HASTA_NOTA = 17 * 60
    const val MIN_NOTA = 5
    const val ANTES_MIN = 60

    /** Pasada la primera actividad, todavía se inicia sola durante este rato (teléfono apagado a la hora). */
    const val GRACIA_MIN = 120

    /** Tipos con los que la persona sale a la calle: estos inician la jornada. */
    val DE_RUTA = setOf(TipoActividad.VISITA, TipoActividad.ALMUERZO)

    fun pideNota(minuto: Int): Boolean = minuto in DESDE_NOTA until HASTA_NOTA

    fun notaValida(nota: String?): Boolean = (nota?.trim()?.length ?: 0) >= MIN_NOTA

    /** Minuto del día en que la jornada se inicia sola, o null si ese día no hay nada de ruta. */
    fun minutoDeInicio(horas: List<Int>): Int? = horas.minOrNull()?.let { maxOf(0, it - ANTES_MIN) }

    /** ¿Toca iniciarla ahora? Desde 1 h antes de la primera hasta un rato después. */
    fun tocaIniciar(horas: List<Int>, minuto: Int): Boolean {
        val primera = horas.minOrNull() ?: return false
        return minuto >= primera - ANTES_MIN && minuto < primera + GRACIA_MIN
    }
}

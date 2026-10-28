package com.dmujeres.app.cronograma

/**
 * Reglas del día de trabajo (sin Android, se prueba en la JVM).
 *
 * Una persona no está en dos actividades a la vez. Si lo que se escribe se
 * cruza con otra actividad del día, manda lo último que se escribió y la
 * otra se acomoda:
 *  - la que empezó antes termina cuando empieza esta (8:00–9:01 y luego
 *    9:00–10:00: la primera queda 8:00–9:00);
 *  - la que sigue empieza cuando termina esta;
 *  - si esta cae dentro de otra (almuerzo en medio de una visita larga), la
 *    otra se parte en dos;
 *  - si esta tapa a otra por completo, decide la persona (cambiar las horas
 *    o eliminar la otra).
 * Las actividades sin hora de fin no entran: no se sabe cuánto duraron.
 */
object AgendaDia {

    /** Tramo del día en minutos, [inicio, fin). */
    data class Tramo(val inicio: Int, val fin: Int) {
        val minutos: Int get() = fin - inicio
    }

    enum class Cruce {
        /** La otra empezó antes: termina cuando empieza esta. */
        RECORTAR_FIN,

        /** La otra sigue después: empieza cuando termina esta. */
        CORRER_INICIO,

        /** Esta cae dentro de la otra: la otra queda antes y después. */
        DIVIDIR,

        /** Esta tapa a la otra por completo: decide la persona. */
        CUBIERTA,
    }

    /** Cómo queda una actividad vecina al guardar; [tramos] vacío si queda tapada. */
    data class Ajuste<T>(val actividad: T, val cruce: Cruce, val antes: Tramo, val tramos: List<Tramo>)

    fun <T> ajustes(otras: List<T>, nuevo: Tramo, tramo: (T) -> Tramo?): List<Ajuste<T>> =
        otras.mapNotNull { otra ->
            val t = tramo(otra) ?: return@mapNotNull null
            if (t.inicio >= nuevo.fin || nuevo.inicio >= t.fin) return@mapNotNull null
            val empiezaAntes = t.inicio < nuevo.inicio
            val sigueDespues = t.fin > nuevo.fin
            when {
                empiezaAntes && sigueDespues -> Ajuste(
                    otra, Cruce.DIVIDIR, t,
                    listOf(Tramo(t.inicio, nuevo.inicio), Tramo(nuevo.fin, t.fin)),
                )
                empiezaAntes -> Ajuste(otra, Cruce.RECORTAR_FIN, t, listOf(Tramo(t.inicio, nuevo.inicio)))
                sigueDespues -> Ajuste(otra, Cruce.CORRER_INICIO, t, listOf(Tramo(nuevo.fin, t.fin)))
                else -> Ajuste(otra, Cruce.CUBIERTA, t, emptyList())
            }
        }.sortedBy { it.antes.inicio }

    /**
     * Tramo de la actividad en curso (iniciada y sin finalizar) para cruzarla
     * con lo que se escribe: va desde que empezó hasta el minuto actual. Así,
     * agregar otra actividad la acomoda a la vista en vez de cerrarla sin
     * avisar, y una programada para más tarde no la toca.
     */
    /** Un día se corrige hasta esta hora del día siguiente; luego se cierra para el reporte. */
    const val CIERRE_MINUTO = 11 * 60 + 15

    fun diaCerrado(fecha: String, ayer: String, minutoAhora: Int): Boolean =
        fecha < ayer || (fecha == ayer && minutoAhora >= CIERRE_MINUTO)

    /** Minuto llevado al cuarto de hora más cercano, para arrastrar en la regla. */
    fun alCuarto(minuto: Int): Int = ((minuto + 7) / 15 * 15).coerceIn(0, FIN_DEL_DIA)

    /** ¿El rato [inicio, fin) pisa alguno de los tramos? */
    fun seCruza(tramos: List<Tramo>, inicio: Int, fin: Int): Boolean = tramos.any { it.inicio < fin && it.fin > inicio }

    fun tramoEnCurso(inicio: Int, ahora: Int): Tramo = Tramo(inicio, maxOf(ahora, inicio) + 1)

    /**
     * La otra opción: mover esta para no tocar a las demás. Empieza cuando
     * termina la anterior y termina cuando empieza la siguiente. Null si no
     * hay espacio o si esta cae dentro de otra o la tapa.
     */
    fun <T> alternativa(ajustes: List<Ajuste<T>>, nuevo: Tramo): Tramo? {
        if (ajustes.isEmpty()) return null
        if (ajustes.any { it.cruce == Cruce.DIVIDIR || it.cruce == Cruce.CUBIERTA }) return null
        val inicio = ajustes.filter { it.cruce == Cruce.RECORTAR_FIN }.maxOfOrNull { it.antes.fin } ?: nuevo.inicio
        val fin = ajustes.filter { it.cruce == Cruce.CORRER_INICIO }.minOfOrNull { it.antes.inicio } ?: nuevo.fin
        return Tramo(inicio, fin).takeIf { it.fin > it.inicio }
    }

    /**
     * Primer inicio, desde [desde], donde cabe una actividad de [duracion]
     * minutos sin cruzarse con [tramos]: si choca, se prueba cuando termina la
     * que estorba. Null si ya no cabe en el día.
     */
    fun proximoLibre(tramos: List<Tramo>, desde: Int, duracion: Int): Int? {
        var inicio = desde
        while (inicio + duracion <= FIN_DEL_DIA) {
            val choque = tramos.filter { it.inicio < inicio + duracion && it.fin > inicio }.maxByOrNull { it.fin } ?: return inicio
            inicio = choque.fin
        }
        return null
    }

    /**
     * Huecos sin registrar de al menos [minimo] minutos entre [desde] (inicio
     * de jornada o primera actividad) y [hasta] (ahora, si es hoy; null en
     * otros días). Las actividades sin hora de fin duran hasta la siguiente.
     */
    fun huecos(tramos: List<Tramo>, desde: Int?, hasta: Int?, minimo: Int = 15): List<Tramo> {
        val orden = tramos.sortedBy { it.inicio }
        var cursor = desde ?: orden.firstOrNull()?.inicio ?: return emptyList()
        val salida = mutableListOf<Tramo>()
        for (t in orden) {
            val tope = if (hasta != null) minOf(t.inicio, hasta) else t.inicio
            if (tope - cursor >= minimo) salida += Tramo(cursor, tope)
            cursor = maxOf(cursor, t.fin)
        }
        if (hasta != null && hasta - cursor >= minimo) salida += Tramo(cursor, hasta)
        return salida
    }

    /**
     * Tramos del día para huecos y totales: con hora de fin, ese rango; sin
     * ella, hasta la siguiente actividad o hasta el final del día.
     */
    fun <T> tramosDelDia(lista: List<T>, hora: (T) -> String, horaFin: (T) -> String?): List<Tramo> {
        val orden = lista.sortedBy { hora(it) }
        return orden.mapIndexed { i, a ->
            val inicio = HoraCronograma.aMinutos(hora(a))
            val fin = horaFin(a)?.let { HoraCronograma.aMinutos(it) }
                ?: orden.getOrNull(i + 1)?.let { HoraCronograma.aMinutos(hora(it)) }
                ?: FIN_DEL_DIA
            Tramo(inicio, maxOf(inicio, fin))
        }
    }

    /** Minutos cubiertos (sin contar dos veces lo que se cruce). */
    fun cubiertos(tramos: List<Tramo>): Int {
        var total = 0
        var hasta = Int.MIN_VALUE
        for (t in tramos.sortedBy { it.inicio }) {
            val desde = maxOf(t.inicio, hasta)
            if (t.fin > desde) total += t.fin - desde
            hasta = maxOf(hasta, t.fin)
        }
        return total
    }

    const val FIN_DEL_DIA = 24 * 60
}

/** ¿El día ya se cerró para el reporte? Con la hora de Guayaquil. */
object CierreDia {
    private val zona = java.util.TimeZone.getTimeZone("America/Guayaquil")

    fun cerrado(fecha: String, ahora: java.util.Calendar = java.util.Calendar.getInstance(zona)): Boolean {
        val iso = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }
        val ayer = iso.format((ahora.clone() as java.util.Calendar).apply { add(java.util.Calendar.DAY_OF_MONTH, -1) }.time)
        val minuto = ahora.get(java.util.Calendar.HOUR_OF_DAY) * 60 + ahora.get(java.util.Calendar.MINUTE)
        return AgendaDia.diaCerrado(fecha, ayer, minuto)
    }

    /** Ayer, mientras todavía se puede corregir. */
    fun porCerrar(fecha: String, ahora: java.util.Calendar = java.util.Calendar.getInstance(zona)): Boolean {
        val iso = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }
        val ayer = iso.format((ahora.clone() as java.util.Calendar).apply { add(java.util.Calendar.DAY_OF_MONTH, -1) }.time)
        return fecha == ayer && !cerrado(fecha, ahora)
    }
}

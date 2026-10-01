package com.dmujeres.app.cronograma

import android.content.Context
import androidx.preference.PreferenceManager
import org.json.JSONArray
import org.json.JSONObject
import com.dmujeres.app.DmujeresApi
import com.dmujeres.app.PositionProvider
import com.dmujeres.app.StatusActivity
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/** Tipos de actividad del cronograma (mismos códigos que el servidor). */
enum class TipoActividad(val codigo: String, val etiqueta: String) {
    VISITA("visita", "Visita"),
    ALMUERZO("almuerzo", "Almuerzo"),
    PERMISO_MEDICO("permiso_medico", "Permiso médico"),
    VACACIONES("vacaciones", "Vacaciones"),
    PERMISO("permiso", "Permiso"),
    NOVEDAD("novedad", "Novedad");

    companion object {
        fun de(codigo: String?): TipoActividad = entries.firstOrNull { it.codigo == codigo } ?: VISITA
    }
}

data class Actividad(
    val clientId: String,
    val fecha: String,
    val hora: String,
    /** Hora de fin "HH:mm" (opcional: las actividades viejas no la tienen). */
    val horaFin: String? = null,
    val tipo: TipoActividad,
    val lugar: String?,
    val nota: String?,
    val registradoEn: Long,
    val lat: Double? = null,
    val lon: Double? = null,
    val precision: Float? = null,
    val conUbicacion: Boolean = false,
    val pendiente: Boolean = false,
    val eliminada: Boolean = false,
) {
    fun aJson(): JSONObject = JSONObject()
        .put("clientId", clientId).put("fecha", fecha).put("hora", hora).put("horaFin", horaFin ?: JSONObject.NULL).put("tipo", tipo.codigo)
        .put("lugar", lugar ?: JSONObject.NULL).put("nota", nota ?: JSONObject.NULL)
        .put("at", registradoEn).put("lat", lat ?: JSONObject.NULL).put("lon", lon ?: JSONObject.NULL)
        .put("accuracy", precision?.toDouble() ?: JSONObject.NULL)
        .put("conUbicacion", conUbicacion).put("pendiente", pendiente).put("deleted", eliminada)

    companion object {
        fun deJson(o: JSONObject): Actividad = Actividad(
            clientId = o.getString("clientId"),
            fecha = o.getString("fecha"),
            hora = o.getString("hora"),
            horaFin = o.optString("horaFin").takeIf { !o.isNull("horaFin") && it.matches(Regex("\\d{2}:\\d{2}")) },
            tipo = TipoActividad.de(o.optString("tipo")),
            lugar = o.optString("lugar").takeIf { !o.isNull("lugar") && it.isNotBlank() },
            nota = o.optString("nota").takeIf { !o.isNull("nota") && it.isNotBlank() },
            registradoEn = o.optLong("registradoEn", o.optLong("at", 0L)),
            lat = if (o.isNull("lat") || !o.has("lat")) null else o.optDouble("lat"),
            lon = if (o.isNull("lon") || !o.has("lon")) null else o.optDouble("lon"),
            precision = if (o.isNull("accuracy") || !o.has("accuracy")) null else o.optDouble("accuracy").toFloat(),
            conUbicacion = o.optBoolean("conUbicacion", false),
            pendiente = o.optBoolean("pendiente", false),
            eliminada = o.optBoolean("deleted", false),
        )
    }
}

/**
 * Almacén del cronograma en el teléfono: copia de lo que hay en el servidor y
 * lo cargado sin conexión (pendiente de subir). Todo se guarda al instante y se
 * sube en segundo plano; así se puede completar la ruta sin señal.
 */
object Actividades {
    private const val KEY = "cronogramaLocal"
    private const val KEY_SYNC_AT = "cronogramaSincronizadoEn"
    private const val MAX = 800

    @Synchronized
    fun todas(context: Context): List<Actividad> {
        val raw = PreferenceManager.getDefaultSharedPreferences(context).getString(KEY, null) ?: return emptyList()
        return runCatching {
            val a = JSONArray(raw)
            List(a.length()) { Actividad.deJson(a.getJSONObject(it)) }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    private fun guardarTodas(context: Context, lista: List<Actividad>) {
        val a = JSONArray()
        lista.sortedWith(compareBy({ it.fecha }, { it.hora })).takeLast(MAX).forEach { a.put(it.aJson()) }
        PreferenceManager.getDefaultSharedPreferences(context).edit().putString(KEY, a.toString()).commit()
    }

    // Orden estable: por hora y, a igual hora, por orden de carga.
    fun delDia(context: Context, fecha: String): List<Actividad> =
        todas(context).filter { it.fecha == fecha && !it.eliminada }
            .sortedWith(compareBy({ it.hora }, { it.registradoEn }))

    fun delMes(context: Context, mes: String): List<Actividad> =
        todas(context).filter { it.fecha.startsWith(mes) && !it.eliminada }

    /** Fechas con actividades entre [desde] y [hasta] (para los puntos de la semana). */
    fun fechasConActividad(context: Context, desde: String, hasta: String): Set<String> =
        todas(context).filter { !it.eliminada && it.fecha >= desde && it.fecha <= hasta }.map { it.fecha }.toSet()

    fun pendientes(context: Context): Int = todas(context).count { it.pendiente }

    /** Última vez que el teléfono quedó al día con el servidor (0 = nunca). */
    fun sincronizadoEn(context: Context): Long =
        PreferenceManager.getDefaultSharedPreferences(context).getLong(KEY_SYNC_AT, 0L)

    private fun marcarSincronizado(context: Context) {
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putLong(KEY_SYNC_AT, System.currentTimeMillis()).apply()
    }

    /**
     * Actividad nueva. La ubicación solo se guarda si la jornada está iniciada
     * y la actividad es de hoy: es "dónde se cargó" (el servidor lo vuelve a
     * revisar).
     */
    fun nueva(
        context: Context,
        fecha: String,
        hoy: String,
        tipo: TipoActividad,
        hora: String,
        horaFin: String?,
        lugar: String?,
        nota: String?,
    ): Actividad {
        val ubic = if (DmujeresApi.isJourneyOpen(context) && fecha == hoy) ubicacionReciente(context) else null
        return Actividad(
            clientId = UUID.randomUUID().toString(),
            fecha = fecha,
            hora = hora,
            horaFin = horaFin,
            tipo = tipo,
            lugar = lugar,
            nota = nota,
            registradoEn = System.currentTimeMillis(),
            lat = ubic?.first,
            lon = ubic?.second,
            precision = ubic?.third?.takeIf { it >= 0 },
        )
    }

    /** Último fix de la captura si es reciente (≤ 5 min). */
    private fun ubicacionReciente(context: Context): Triple<Double, Double, Float>? {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val at = prefs.getLong(PositionProvider.KEY_LAST_FIX_AT, 0L)
        if (at <= 0L || System.currentTimeMillis() - at > 5 * 60_000L) return null
        val lat = prefs.getString(PositionProvider.KEY_LAST_FIX_LAT, null)?.toDoubleOrNull() ?: return null
        val lon = prefs.getString(PositionProvider.KEY_LAST_FIX_LON, null)?.toDoubleOrNull() ?: return null
        return Triple(lat, lon, prefs.getFloat(PositionProvider.KEY_LAST_FIX_ACC, -1f))
    }

    /** Alta o edición: queda guardada y pendiente de subir. */
    @Synchronized
    fun guardar(context: Context, actividad: Actividad) = guardarVarias(context, listOf(actividad))

    /** Varias de una vez (la actividad y las vecinas que se acomodaron). */
    @Synchronized
    fun guardarVarias(context: Context, actividades: List<Actividad>) {
        val ids = actividades.map { it.clientId }.toSet()
        val lista = todas(context).filter { it.clientId !in ids }.toMutableList()
        actividades.forEach { lista.add(it.copy(pendiente = true)) }
        guardarTodas(context, lista)
        sincronizar(context)
    }

    @Synchronized
    fun eliminar(context: Context, actividad: Actividad) {
        guardar(context, actividad.copy(eliminada = true))
    }

    /**
     * Lugares escritos antes, del más usado al menos usado: se sugieren al
     * escribir para no repetir y para que los nombres coincidan en el panel.
     */
    fun lugaresFrecuentes(context: Context): List<String> =
        todas(context).mapNotNull { it.lugar?.trim()?.takeIf { l -> l.isNotEmpty() } }
            .groupingBy { it.lowercase() }.eachCount().entries
            .sortedByDescending { it.value }
            .mapNotNull { e -> todas(context).firstOrNull { it.lugar?.trim()?.lowercase() == e.key }?.lugar?.trim() }

    private val sincronizando = AtomicBoolean(false)
    private val alTerminarSubida = CopyOnWriteArrayList<() -> Unit>()

    /** Momento en que se subió cada actividad (para no perderla al mezclar con el servidor). */
    private val subidasRecientes = ConcurrentHashMap<String, Long>()

    /**
     * Sube lo pendiente en orden; se reintenta al abrir, al guardar y con el
     * latido. Si ya hay una subida en curso, [alTerminar] espera a que acabe.
     * Lo que se guarde mientras sube también sale en la misma pasada.
     */
    fun sincronizar(context: Context, alTerminar: (() -> Unit)? = null) {
        alTerminar?.let { alTerminarSubida.add(it) }
        if (!sincronizando.compareAndSet(false, true)) return
        val app = context.applicationContext
        Thread {
            try {
                var todoSubido = true
                var vueltas = 0
                while (todoSubido && vueltas++ < 5) {
                    val pendientes = todas(app).filter { it.pendiente }
                    if (pendientes.isEmpty()) break
                    for (a in pendientes) {
                        if (!DmujeresApi.postActividad(app, a.aJson())) {
                            todoSubido = false
                            break
                        }
                        marcarSubida(app, a)
                        StatusActivity.addMessage("Cronograma: ${a.tipo.etiqueta.lowercase()} de las ${a.hora} sincronizada")
                    }
                }
                if (todoSubido && pendientes(app) == 0) marcarSincronizado(app)
            } finally {
                sincronizando.set(false)
                val esperando = alTerminarSubida.toList()
                alTerminarSubida.removeAll(esperando.toSet())
                esperando.forEach { it() }
            }
        }.start()
    }

    @Synchronized
    private fun marcarSubida(context: Context, subida: Actividad) {
        val lista = todas(context).mapNotNull {
            when {
                it.clientId != subida.clientId -> it
                // Si se editó de nuevo mientras subía, sigue pendiente.
                it.registradoEn != subida.registradoEn || it != subida -> it
                it.eliminada -> null
                else -> it.copy(pendiente = false)
            }
        }
        subidasRecientes[subida.clientId] = System.currentTimeMillis()
        guardarTodas(context, lista)
    }

    /**
     * Trae un rango del servidor y lo mezcla con lo del teléfono: lo pendiente
     * del teléfono manda (todavía no llegó); lo demás se toma del servidor.
     */
    fun actualizar(context: Context, desde: String, hasta: String, alTerminar: (Boolean) -> Unit) {
        val app = context.applicationContext
        Thread {
            val consultadoEn = System.currentTimeMillis()
            val remoto = DmujeresApi.fetchActividades(app, desde, hasta)
            if (remoto != null) {
                synchronized(this) {
                    val locales = todas(app)
                    val pendientes = locales.filter { it.pendiente }.associateBy { it.clientId }
                    // Lo subido mientras se consultaba todavía no viene en la
                    // respuesta: manda lo del teléfono.
                    val recientes = subidasRecientes.filterValues { it >= consultadoEn }.keys
                    val fuera = locales.filter { it.fecha < desde || it.fecha > hasta || it.pendiente }
                    val delServidor = List(remoto.length()) { Actividad.deJson(remoto.getJSONObject(it)) }
                        .filter { it.clientId !in pendientes && it.clientId !in recientes }
                    val recienSubidas = locales.filter {
                        it.clientId in recientes && !it.pendiente && it.fecha >= desde && it.fecha <= hasta
                    }
                    guardarTodas(app, fuera + delServidor + recienSubidas)
                }
                if (pendientes(app) == 0) marcarSincronizado(app)
            }
            alTerminar(remoto != null)
        }.start()
    }
}

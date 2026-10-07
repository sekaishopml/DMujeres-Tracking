package com.dmujeres.app.cronograma

import android.content.Context
import androidx.preference.PreferenceManager
import com.dmujeres.app.red.DmujeresApi
import org.json.JSONArray
import org.json.JSONObject

data class Cliente(val id: Long, val nombre: String, val direccion: String?, val lat: Double?, val lon: Double?)

/**
 * Lista de clientes para elegir al registrar una visita. Se guarda en el
 * teléfono (sirve sin señal) y se renueva al abrir el cronograma. Si la
 * persona escribe un cliente que no está, el servidor lo agrega solo.
 */
object Clientes {
    private const val KEY = "clientesLista"

    fun todos(context: Context): List<Cliente> {
        val raw = PreferenceManager.getDefaultSharedPreferences(context).getString(KEY, null) ?: return emptyList()
        return runCatching { leer(JSONArray(raw)) }.getOrDefault(emptyList())
    }

    /** Trae la lista del servidor en segundo plano; sin conexión se queda la guardada. */
    fun actualizar(context: Context, alTerminar: () -> Unit = {}) {
        val app = context.applicationContext
        Thread {
            DmujeresApi.fetchClientes(app)?.let { lista ->
                PreferenceManager.getDefaultSharedPreferences(app).edit().putString(KEY, lista.toString()).apply()
            }
            alTerminar()
        }.start()
    }

    /** Los más cercanos a la parada primero; sin ubicación, por nombre. */
    fun ordenados(context: Context, lat: Double?, lon: Double?): List<Cliente> {
        val lista = todos(context)
        if (lat == null || lon == null) return lista.sortedBy { it.nombre.lowercase() }
        return lista.sortedWith(compareBy({ distanciaM(lat, lon, it) ?: Double.MAX_VALUE }, { it.nombre.lowercase() }))
    }

    fun distanciaM(lat: Double, lon: Double, c: Cliente): Double? {
        val cLat = c.lat ?: return null
        val cLon = c.lon ?: return null
        val rad = Math.PI / 180
        val dLat = (cLat - lat) * rad
        val dLon = (cLon - lon) * rad
        val h = Math.sin(dLat / 2).let { it * it } +
            Math.cos(lat * rad) * Math.cos(cLat * rad) * Math.sin(dLon / 2).let { it * it }
        return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
    }

    fun leer(lista: JSONArray): List<Cliente> = List(lista.length()) { i ->
        val o: JSONObject = lista.getJSONObject(i)
        Cliente(
            id = o.optLong("id"),
            nombre = o.optString("nombre"),
            direccion = o.optString("direccion").takeIf { !o.isNull("direccion") && it.isNotBlank() },
            lat = if (o.isNull("lat")) null else o.optDouble("lat"),
            lon = if (o.isNull("lon")) null else o.optDouble("lon"),
        )
    }.filter { it.nombre.isNotBlank() }
}

/** Parada del día según el GPS: de dónde a dónde estuvo detenido. */
data class ParadaGps(val inicio: Long, val fin: Long, val lat: Double, val lon: Double)

/** Paradas por día, pedidas al servidor y recordadas mientras la app está abierta. */
object ParadasDia {
    private val cache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, List<ParadaGps>>>()
    private const val VIGENCIA_MS = 3 * 60_000L

    fun guardadas(fecha: String): List<ParadaGps> = cache[fecha]?.second ?: emptyList()

    fun cargar(context: Context, fecha: String, alTerminar: (List<ParadaGps>) -> Unit) {
        val previa = cache[fecha]
        if (previa != null && System.currentTimeMillis() - previa.first < VIGENCIA_MS) {
            alTerminar(previa.second)
            return
        }
        val app = context.applicationContext
        Thread {
            val lista = DmujeresApi.fetchParadas(app, fecha)?.let { a ->
                List(a.length()) { i ->
                    val o = a.getJSONObject(i)
                    ParadaGps(o.optLong("inicio"), o.optLong("fin"), o.optDouble("lat"), o.optDouble("lon"))
                }
            }
            if (lista != null) cache[fecha] = System.currentTimeMillis() to lista
            alTerminar(lista ?: previa?.second ?: emptyList())
        }.start()
    }
}

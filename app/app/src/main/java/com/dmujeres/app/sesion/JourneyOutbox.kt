package com.dmujeres.app.sesion

import android.content.Context
import androidx.preference.PreferenceManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cola persistente de avisos de jornada (inicio/fin) pendientes de llegar al
 * servidor. Sobrevive a reinicios de la app y del teléfono.
 */
object JourneyOutbox {
    private const val KEY = "journeyOutbox"
    private const val MAX_EVENTS = 50

    data class Event(val action: String, val journeyId: Long, val at: Long)

    @Synchronized
    fun enqueue(context: Context, action: String, journeyId: Long, at: Long) {
        val list = read(context)
        list.add(Event(action, journeyId, at))
        write(context, list.takeLast(MAX_EVENTS))
    }

    @Synchronized
    fun peek(context: Context): Event? = read(context).firstOrNull()

    @Synchronized
    fun remove(context: Context, event: Event) {
        val list = read(context)
        list.remove(event)
        write(context, list)
    }

    @Synchronized
    fun size(context: Context): Int = read(context).size

    /** ¿Hay un aviso de fin sin enviar para esta jornada? */
    @Synchronized
    fun hasPendingStop(context: Context, journeyId: Long): Boolean =
        read(context).any { it.action == "stop" && it.journeyId == journeyId }

    private fun read(context: Context): MutableList<Event> {
        val raw = PreferenceManager.getDefaultSharedPreferences(context).getString(KEY, null) ?: return mutableListOf()
        return runCatching {
            val array = JSONArray(raw)
            MutableList(array.length()) { i ->
                val o = array.getJSONObject(i)
                Event(o.getString("action"), o.getLong("journeyId"), o.getLong("at"))
            }
        }.getOrDefault(mutableListOf())
    }

    private fun write(context: Context, list: List<Event>) {
        val array = JSONArray()
        list.forEach { array.put(JSONObject().put("action", it.action).put("journeyId", it.journeyId).put("at", it.at)) }
        PreferenceManager.getDefaultSharedPreferences(context).edit().putString(KEY, array.toString()).commit()
    }
}

/*
 * Copyright 2012 - 2021 Anton Tananaev (anton@traccar.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.dmujeres.app

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.LinkedList
import java.util.Locale

/**
 * Consola del teléfono: el estado en una línea, seis datos que se actualizan
 * cada 5 s y lo que va pasando en vivo, lo más nuevo arriba.
 */
class StatusActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            refresh()
            handler.postDelayed(this, REFRESH_MS)
        }
    }
    private val onMessages: () -> Unit = { handler.post { mostrarNuevos() } }
    // Último mensaje ya dibujado: solo se agregan los nuevos, sin redibujar todo.
    private var dibujados = -1L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_status)
        Responsivo.raiz(this)?.let { Responsivo.centrarHijos(it, Responsivo.ANCHO_PANEL_DP) }
        findViewById<View>(R.id.console_back).setOnClickListener { finish() }
        findViewById<TextView>(R.id.console_subtitle).text =
            getString(R.string.console_subtitle_fmt, BuildConfig.VERSION_NAME)
        findViewById<View>(R.id.console_clear).setOnClickListener { clearMessages() }
    }

    override fun onResume() {
        super.onResume()
        listeners.add(onMessages)
        renderMessages()
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    override fun onPause() {
        super.onPause()
        listeners.remove(onMessages)
        handler.removeCallbacks(ticker)
    }

    private fun setTile(id: Int, value: String, colorRes: Int = R.color.text_primary) {
        findViewById<TextView>(id)?.apply {
            text = value
            setTextColor(getColor(colorRes))
        }
    }

    /** Estado con el mismo criterio del home, más los indicadores. */
    private fun refresh() {
        val open = DmujeresApi.isJourneyOpen(this)
        val running = TrackingService.isRunning
        val gpsOn = runCatching {
            (getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager)
                .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        }.getOrDefault(true)
        val failing = ConnectionState.isFailing()
        val (color, label) = when {
            !gpsOn -> R.color.primary to getString(R.string.pill_location_off)
            !open -> R.color.text_tertiary to getString(R.string.pill_disabled)
            !running || failing -> R.color.warn to getString(R.string.pill_no_connection)
            else -> R.color.ok to getString(R.string.pill_online)
        }
        findViewById<ImageView>(R.id.status_dot).setColorFilter(getColor(color))
        findViewById<TextView>(R.id.status_state).text = label
        findViewById<TextView>(R.id.status_journey).text = if (open) {
            getString(R.string.console_journey_open_fmt, DmujeresApi.journeyStartedAtLabel(this))
        } else {
            getString(R.string.console_journey_closed)
        }

        setTile(R.id.tile_gps, getString(if (gpsOn) R.string.console_on else R.string.console_off),
            if (gpsOn) R.color.ok else R.color.primary)
        val lastFix = PreferenceManager.getDefaultSharedPreferences(this).getLong(PositionProvider.KEY_LAST_FIX_AT, 0L)
        setTile(R.id.tile_fix, ago(lastFix))
        setTile(R.id.tile_net, getString(if (failing) R.string.console_offline else R.string.console_online),
            if (failing) R.color.warn else R.color.ok)
        val battery = readBatteryStatus(this)
        setTile(R.id.tile_battery, "${battery.level.toInt()}%" + if (battery.charging) " ⚡" else "",
            if (battery.level <= 15 && !battery.charging) R.color.primary else R.color.text_primary)
        val outbox = JourneyOutbox.size(this)
        setTile(R.id.tile_sync,
            if (outbox == 0) getString(R.string.console_synced) else getString(R.string.console_pending_events_fmt, outbox),
            if (outbox == 0) R.color.ok else R.color.warn)
        Thread {
            val pending = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(0)
            runOnUiThread {
                if (!isFinishing && !isDestroyed) setTile(R.id.tile_pending, pending.toString())
            }
        }.start()
    }

    private fun ago(at: Long): String {
        if (at <= 0L) return getString(R.string.console_never)
        val seconds = ((System.currentTimeMillis() - at) / 1000).coerceAtLeast(0)
        return when {
            seconds < 60 -> getString(R.string.console_seconds_fmt, seconds.toInt())
            seconds < 3600 -> getString(R.string.console_minutes_fmt, (seconds / 60).toInt())
            else -> getString(R.string.console_hours_fmt, (seconds / 3600).toInt())
        }
    }

    private fun renderMessages() {
        if (isFinishing || isDestroyed) return
        val list = findViewById<LinearLayout>(R.id.console_list) ?: return
        list.removeAllViews()
        val (snapshot, ultimo) = synchronized(messages) { messages.toList() to secuencia }
        dibujados = ultimo
        if (snapshot.isEmpty()) {
            list.addView(fila(getString(R.string.console_empty), vacia = true))
            return
        }
        snapshot.forEach { list.addView(fila(it)) }
    }

    /** Agrega arriba solo lo nuevo, con una entrada suave de arriba hacia abajo. */
    private fun mostrarNuevos() {
        if (isFinishing || isDestroyed) return
        val list = findViewById<LinearLayout>(R.id.console_list) ?: return
        val (snapshot, ultimo) = synchronized(messages) { messages.toList() to secuencia }
        val nuevos = (ultimo - dibujados).toInt()
        if (snapshot.isEmpty() || dibujados < 0 || nuevos <= 0 || nuevos >= LIMIT ||
            (list.childCount == 1 && list.getChildAt(0).tag == VACIA)
        ) {
            renderMessages()
            return
        }
        dibujados = ultimo
        for (i in nuevos - 1 downTo 0) {
            val row = fila(snapshot[i])
            list.addView(row, 0)
            row.alpha = 0f
            row.translationY = -24f * resources.displayMetrics.density
            row.animate().alpha(1f).translationY(0f).setDuration(260)
                .setInterpolator(android.view.animation.DecelerateInterpolator()).start()
        }
        while (list.childCount > LIMIT) list.removeViewAt(list.childCount - 1)
    }

    private fun fila(entry: String, vacia: Boolean = false): View {
        val row = LayoutInflater.from(this).inflate(R.layout.item_console, findViewById(R.id.console_list), false)
        val cut = entry.indexOf(" - ")
        row.findViewById<TextView>(R.id.console_time).text = if (cut > 0 && !vacia) entry.substring(0, cut) else ""
        row.findViewById<TextView>(R.id.console_text).apply {
            text = if (cut > 0 && !vacia) entry.substring(cut + 3) else entry
            if (vacia) setTextColor(getColor(R.color.text_tertiary))
        }
        if (vacia) row.tag = VACIA
        return row
    }

    companion object {
        private const val REFRESH_MS = 5_000L
        private const val LIMIT = 30
        private const val PREFS = "statusConsole"
        private const val KEY = "messages"
        private val messages = LinkedList<String>()
        private const val VACIA = "vacia"
        // Cuenta los mensajes agregados (no baja al recortar): dice cuántos son nuevos.
        private var secuencia = 0L
        private val listeners: MutableSet<() -> Unit> = java.util.Collections.synchronizedSet(HashSet())

        /** Contexto de aplicación para persistir la consola entre arranques. */
        private var appContext: Context? = null

        /** Se llama una vez desde la app: carga lo guardado. */
        fun attach(context: Context) {
            appContext = context.applicationContext
            load()
        }

        private fun load() {
            val context = appContext ?: return
            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
            runCatching {
                val array = org.json.JSONArray(raw)
                synchronized(messages) {
                    messages.clear()
                    for (index in 0 until array.length()) messages.add(array.getString(index))
                }
            }
        }

        private fun persist() {
            val context = appContext ?: return
            runCatching {
                val array = org.json.JSONArray()
                synchronized(messages) { messages.forEach { array.put(it) } }
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
            }
        }

        private fun notifyListeners() {
            val copy = synchronized(listeners) { listeners.toList() }
            copy.forEach { runCatching { it() } }
        }

        /**
         * La llaman el servicio y la captura desde cualquier hilo: la lista se
         * sincroniza y la pantalla se redibuja en el hilo principal.
         */
        fun addMessage(originalMessage: String) {
            val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
            synchronized(messages) {
                messages.addFirst("$time - $originalMessage")
                secuencia++
                while (messages.size > LIMIT) messages.removeLast()
            }
            persist()
            notifyListeners()
        }

        fun clearMessages() {
            synchronized(messages) {
                messages.clear()
                secuencia++
            }
            persist()
            notifyListeners()
        }
    }
}

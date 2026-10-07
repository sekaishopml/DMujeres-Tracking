package com.dmujeres.app.sistema

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.preference.PreferenceManager
import com.dmujeres.app.R
import com.dmujeres.app.pantallas.StatusActivity
import com.dmujeres.app.red.DmujeresApi
import org.json.JSONArray
import org.json.JSONObject

/**
 * Apagado y encendido del teléfono, con su causa, para el panel.
 *
 * - Apagado ordenado (el usuario lo apaga o el sistema lo apaga al quedarse
 *   sin batería): llega ACTION_SHUTDOWN. Con <= [BATTERY_DEAD_PCT] % y sin
 *   cargador la causa es "battery"; si no, "manual".
 * - Muerte súbita (sin aviso): al volver a encender se mira la última batería
 *   vista; si era <= [BATTERY_INFER_PCT] % se registra el apagado por batería
 *   con la hora de esa última lectura.
 * Los avisos se guardan en una cola persistente y se envían al volver la red
 * (al apagarse casi nunca hay tiempo de subir nada).
 */
object PowerEvents {

    const val BATTERY_DEAD_PCT = 3
    const val BATTERY_INFER_PCT = 5
    private const val KEY_QUEUE = "powerOutbox"
    private const val KEY_LAST_BATTERY = "powerLastBattery"
    private const val KEY_LAST_BATTERY_AT = "powerLastBatteryAt"
    private const val KEY_SHUTDOWN_RECORDED_AT = "powerShutdownRecordedAt"
    private const val MAX_EVENTS = 20

    /** Causa del apagado (pura, testeable). */
    fun causeFor(batteryPct: Int, charging: Boolean): String =
        if (batteryPct in 0..BATTERY_DEAD_PCT && !charging) "battery" else "manual"

    /** ¿El teléfono murió por batería sin avisar? (pura, testeable). */
    fun inferredBatteryDeath(lastBattery: Int, lastBatteryAt: Long, shutdownRecordedAt: Long): Boolean =
        lastBattery in 0..BATTERY_INFER_PCT && lastBatteryAt > 0L && shutdownRecordedAt < lastBatteryAt

    /** Registrar en el servicio: ACTION_SHUTDOWN solo llega a receptores vivos. */
    fun register(context: Context): BroadcastReceiver {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val (pct, charging) = battery(ctx)
                val now = System.currentTimeMillis()
                enqueue(ctx, "shutdown", causeFor(pct, charging), now, pct)
                StatusActivity.addMessage(ctx.getString(R.string.console_shutdown_fmt, pct))
                PreferenceManager.getDefaultSharedPreferences(ctx).edit()
                    .putLong(KEY_SHUTDOWN_RECORDED_AT, now).commit()
                // Intento rápido: con suerte hay red unos segundos más.
                val pending = goAsync()
                Thread {
                    runCatching { flushSync(ctx) }
                    pending.finish()
                }.start()
            }
        }
        val filter = IntentFilter(Intent.ACTION_SHUTDOWN).apply {
            addAction("android.intent.action.QUICKBOOT_POWEROFF")
        }
        context.registerReceiver(receiver, filter)
        return receiver
    }

    /** Al encender: se registra el encendido y, si murió sin avisar, la causa. */
    fun onBoot(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val lastBattery = prefs.getInt(KEY_LAST_BATTERY, -1)
        val lastAt = prefs.getLong(KEY_LAST_BATTERY_AT, 0L)
        val recordedAt = prefs.getLong(KEY_SHUTDOWN_RECORDED_AT, 0L)
        if (inferredBatteryDeath(lastBattery, lastAt, recordedAt)) {
            enqueue(context, "shutdown", "battery", lastAt, lastBattery)
            prefs.edit().putLong(KEY_SHUTDOWN_RECORDED_AT, lastAt).apply()
        }
        val (pct, _) = battery(context)
        enqueue(context, "boot", null, System.currentTimeMillis(), pct)
        StatusActivity.addMessage(context.getString(R.string.console_boot_fmt, pct))
    }

    /** Última batería vista (la llama la captura con cada fix). */
    fun noteBattery(context: Context, pct: Int) {
        if (pct < 0) return
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putInt(KEY_LAST_BATTERY, pct)
            .putLong(KEY_LAST_BATTERY_AT, System.currentTimeMillis())
            .apply()
    }

    @Synchronized
    private fun enqueue(context: Context, event: String, cause: String?, at: Long, battery: Int) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val list = read(context)
        list.add(JSONObject().put("event", event).put("cause", cause ?: JSONObject.NULL).put("at", at).put("battery", battery))
        val array = JSONArray()
        list.takeLast(MAX_EVENTS).forEach { array.put(it) }
        prefs.edit().putString(KEY_QUEUE, array.toString()).commit()
    }

    private fun read(context: Context): MutableList<JSONObject> {
        val raw = PreferenceManager.getDefaultSharedPreferences(context).getString(KEY_QUEUE, null)
            ?: return mutableListOf()
        return runCatching {
            val array = JSONArray(raw)
            MutableList(array.length()) { array.getJSONObject(it) }
        }.getOrDefault(mutableListOf())
    }

    @Synchronized
    private fun dropFirst(context: Context) {
        val list = read(context)
        if (list.isEmpty()) return
        list.removeAt(0)
        val array = JSONArray()
        list.forEach { array.put(it) }
        PreferenceManager.getDefaultSharedPreferences(context).edit().putString(KEY_QUEUE, array.toString()).commit()
    }

    @Volatile
    private var flushing = false

    /** Envío en segundo plano (latido, cola fluyendo, arranque). */
    fun flush(context: Context) {
        if (flushing || read(context).isEmpty()) return
        val app = context.applicationContext
        Thread { runCatching { flushSync(app) } }.start()
    }

    private fun flushSync(context: Context) {
        if (flushing) return
        flushing = true
        try {
            while (true) {
                val next = read(context).firstOrNull() ?: break
                val ok = DmujeresApi.postPowerEvent(context, next)
                if (!ok) break
                dropFirst(context)
            }
        } finally {
            flushing = false
        }
    }

    private fun battery(context: Context): Pair<Int, Boolean> {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return -1 to false
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return pct to charging
    }
}

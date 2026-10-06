package com.dmujeres.app.recovery

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.DmujeresApi
import com.dmujeres.app.Prefs
import com.dmujeres.app.TrackingService

/**
 * Alarma de rescate cada 9 min con `setAndAllowWhileIdle`, la única que el
 * modo de reposo de Android (Doze) respeta sin permisos especiales.
 *
 * No marca el ritmo de la captura: es el rescate para cuando el servicio
 * quedó congelado. Al despertar pide una ubicación NUEVA (nunca la última
 * conocida) y envía la cola.
 *
 * Mantiene la CPU despierta solo un momento (con tope) además del envío.
 * Cada despertar se cuenta en `recovery_count` y se reporta en el latido.
 */
class DozeAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_RECOVER) return
        // Corto y con timeout: si el sistema tarda, se suelta solo.
        val wakeLock = runCatching {
            (context.applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dmujeres:recover").apply {
                    setReferenceCounted(false)
                    acquire(RECEIVER_WAKELOCK_MS)
                }
        }.getOrNull()
        try {
            // Sin jornada la alarma se apaga: no hay captura que rescatar y
            // despertar el teléfono cada 9 min solo gasta batería. Se vuelve a
            // armar al abrir la jornada.
            if (!PreferenceManager.getDefaultSharedPreferences(context)
                    .getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
            ) {
                Log.i(TAG, "alarma sin jornada: no se reprograma")
                return
            }
            countRecovery(context)
            schedule(context) // con jornada se reprograma, haya o no servicio
            val woken = TrackingService.onDozeAlarm(context)
            Log.i(TAG, "despertar de recuperación (servicio_activo=$woken)")
        } finally {
            runCatching { if (wakeLock?.isHeld == true) wakeLock.release() }
        }
    }

    companion object {
        private val TAG = DozeAlarmReceiver::class.java.simpleName
        const val ACTION_RECOVER = "com.dmujeres.app.action.DOZE_RECOVER"

        /** La alarma que Doze respeta sin permiso especial (~9 min mínimo). */
        const val INTERVAL_MS = 9 * 60_000L

        /** Wake lock del receiver: corto, solo el despertar (el envío usa el suyo). */
        private const val RECEIVER_WAKELOCK_MS = 30_000L

        /** Rearma la alarma de rescate (servicio, boot y replace la llaman). */
        fun schedule(context: Context) {
            val manager = context.applicationContext
                .getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pending = pendingIntent(context)
            // Inexacta a propósito: exacta pediría permiso especial sin aporte.
            manager.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                android.os.SystemClock.elapsedRealtime() + INTERVAL_MS,
                pending,
            )
        }

        fun cancel(context: Context) {
            val manager = context.applicationContext
                .getSystemService(Context.ALARM_SERVICE) as AlarmManager
            manager.cancel(pendingIntent(context))
        }

        private fun pendingIntent(context: Context): PendingIntent {
            val intent = Intent(context.applicationContext, DozeAlarmReceiver::class.java)
                .setAction(ACTION_RECOVER)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            return PendingIntent.getBroadcast(context.applicationContext, 0, intent, flags)
        }

        /** Cada recuperación cuenta (persiste en prefs: sobrevive reboot). */
        internal fun countRecovery(context: Context) {
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            val next = prefs.getLong(Prefs.RECOVERY_COUNT, 0L) + 1
            prefs.edit().putLong(Prefs.RECOVERY_COUNT, next).apply()
        }
    }
}

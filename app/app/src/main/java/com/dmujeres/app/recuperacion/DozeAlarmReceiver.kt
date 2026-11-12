package com.dmujeres.app.recuperacion

import com.dmujeres.app.datos.Ajustes
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.seguimiento.TrackingService
import com.dmujeres.app.sistema.ServiceHeartbeat

/**
 * Supervisor con alarma exacta cada 3 min mientras hay jornada abierta.
 *
 * Los pulsos internos de la app (vigilante de GPS, latido) corren en un
 * Handler que se congela con la CPU dormida; la alarma exacta con
 * `setExactAndAllowWhileIdle` despierta igual. En cada despertar:
 * - si el servicio murió (el sistema lo mató), lo vuelve a arrancar: Android
 *   permite iniciar un servicio en primer plano desde una alarma exacta;
 * - si vive, corre la revisión del GPS y de la cola sin esperar al pulso, y
 *   manda el diagnóstico si lleva más de 10 min sin salir.
 * Sin permiso de alarmas exactas cae a la inexacta (~9 min en reposo).
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
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            // Sin jornada la alarma se apaga; se vuelve a armar al abrirla.
            if (!prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)) {
                Log.i(TAG, "alarma sin jornada: no se reprograma")
                return
            }
            countRecovery(context)
            schedule(context)
            if (TrackingService.isRunning) {
                TrackingService.supervisar()
                ServiceHeartbeat.reportIfDue()
                return
            }
            // Servicio muerto con jornada abierta: se vuelve a arrancar.
            prefs.edit().putBoolean(Prefs.STATUS, true).apply()
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, TrackingService::class.java).setAction(TrackingService.ACTION_RECOVER),
                )
                contarReinicio(context)
                Log.w(TAG, "servicio muerto con jornada: rearrancado por la alarma")
            }.onFailure { Log.w(TAG, "el sistema no dejó rearrancar el servicio", it) }
        } finally {
            runCatching { if (wakeLock?.isHeld == true) wakeLock.release() }
        }
    }

    companion object {
        private val TAG = DozeAlarmReceiver::class.java.simpleName
        const val ACTION_RECOVER = "com.dmujeres.app.action.DOZE_RECOVER"

        /** Wake lock del receiver: corto, solo el despertar (el envío usa el suyo). */
        private const val RECEIVER_WAKELOCK_MS = 30_000L

        /** ¿Se pueden usar alarmas exactas? (Android 12+ pide permiso). */
        fun exactas(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
            val manager = context.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            return runCatching { manager.canScheduleExactAlarms() }.getOrDefault(false)
        }

        /** Rearma la alarma de supervisión (servicio, boot y replace la llaman). */
        fun schedule(context: Context, enMs: Long = Ajustes.valor(Ajustes.Clave.SUPERVISION_MS)) {
            val manager = context.applicationContext
                .getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pending = pendingIntent(context)
            val cuando = SystemClock.elapsedRealtime() + enMs
            runCatching {
                if (exactas(context)) {
                    manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pending)
                } else {
                    manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pending)
                }
            }.onFailure {
                manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pending)
            }
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

        /** Veces que la alarma volvió a arrancar el servicio muerto (diagnóstico). */
        const val KEY_REINICIOS = "reiniciosPorAlarma"

        private fun contarReinicio(context: Context) {
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            prefs.edit().putLong(KEY_REINICIOS, prefs.getLong(KEY_REINICIOS, 0L) + 1).apply()
        }

        /** Cada recuperación cuenta (persiste en prefs: sobrevive reboot). */
        internal fun countRecovery(context: Context) {
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            val next = prefs.getLong(Prefs.RECOVERY_COUNT, 0L) + 1
            prefs.edit().putLong(Prefs.RECOVERY_COUNT, next).apply()
        }
    }
}

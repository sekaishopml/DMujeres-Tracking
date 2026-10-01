package com.dmujeres.app

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager

/**
 * Aviso de actualización desde el servicio, sin abrir la app.
 *
 * El aviso de actualización solo aparece al abrir la pantalla principal; quien
 * nunca la abre se queda en una versión vieja. Cada 6 h el latido pregunta
 * si hay versión nueva y, si la hay, deja una notificación que abre la app
 * (ahí se descarga e instala). Instalar siempre lo confirma la persona.
 */
object OtaNotifier {

    private const val TAG = "OtaNotifier"
    private const val KEY_LAST_CHECK = "otaBackgroundCheckAt"
    private const val INTERVAL_MS = 6 * 60 * 60_000L
    private const val NOTIFICATION_ID = 7

    fun maybeCheck(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        if (last in 1..now && now - last < INTERVAL_MS) return
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
        DmujeresApi.checkOta(context) { label, _, _ ->
            if (label != null) notify(context.applicationContext, label)
        }
    }

    private fun notify(context: Context, version: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        runCatching {
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val open = PendingIntent.getActivity(
                context, NOTIFICATION_ID,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                flags,
            )
            val notification = NotificationCompat.Builder(context, MainApplication.PRIMARY_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(context.getString(R.string.ota_notification_title))
                .setContentText(context.getString(R.string.ota_notification_text, version))
                .setStyle(
                    NotificationCompat.BigTextStyle()
                        .bigText(context.getString(R.string.ota_notification_text, version)),
                )
                .setColor(ContextCompat.getColor(context, R.color.primary_dark))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build()
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        }.onFailure { Log.w(TAG, "no se pudo avisar la actualización", it) }
    }
}

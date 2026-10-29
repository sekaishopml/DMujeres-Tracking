package com.dmujeres.app.actualizacion

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
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.R
import com.dmujeres.app.pantallas.MainActivity
import com.dmujeres.app.red.DmujeresApi

/**
 * Actualización desde el servicio, sin abrir la app.
 *
 * Cada 6 h el latido pregunta si hay versión nueva y lo anota. No avisa en el
 * momento (podía ser de madrugada): el aviso "Actualizar app de monitoreo"
 * sale con los avisos de horario (ver AvisosHorarios). Al abrir la app, el
 * banner de arriba la ofrece enseguida. Instalar siempre lo confirma la persona.
 */
object OtaNotifier {

    private const val TAG = "OtaNotifier"
    private const val KEY_LAST_CHECK = "otaBackgroundCheckAt"
    private const val INTERVAL_MS = 6 * 60 * 60_000L
    /** Versión nueva vista y la versión instalada cuando se vio. */
    private const val KEY_DISPONIBLE = "otaDisponible"
    private const val KEY_DISPONIBLE_DESDE = "otaDisponibleDesdeVersion"

    fun maybeCheck(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        if (last in 1..now && now - last < INTERVAL_MS) return
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
        DmujeresApi.checkOta(context) { label, _, _ ->
            prefs.edit().apply {
                if (label != null) {
                    putString(KEY_DISPONIBLE, label)
                    putInt(KEY_DISPONIBLE_DESDE, BuildConfig.VERSION_CODE)
                } else {
                    remove(KEY_DISPONIBLE)
                }
            }.apply()
        }
    }

    /**
     * Hay una versión nueva por instalar: la última revisión la vio y la app no
     * se actualizó desde entonces. Sin conexión vale lo último que se supo.
     */
    fun hayActualizacion(context: Context): Boolean {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        return prefs.getString(KEY_DISPONIBLE, null) != null &&
            prefs.getInt(KEY_DISPONIBLE_DESDE, -1) == BuildConfig.VERSION_CODE
    }

    /** La app se instaló sola y Android la cerró: se vuelve a abrir. */
    const val KEY_REABRIR = "reabrirTrasActualizar"
    private const val ID_ACTUALIZADA = 4712

    /**
     * Tras actualizarse sola: se intenta abrir la app y, como Android puede no
     * dejar abrir pantallas desde segundo plano, queda además un aviso que la
     * abre con un toque (se quita en cuanto la app está a la vista).
     */
    fun reabrir(context: Context) {
        val prefs = androidx.preference.PreferenceManager.getDefaultSharedPreferences(context)
        val desde = prefs.getLong(KEY_REABRIR, 0L)
        if (desde == 0L) return
        prefs.edit().remove(KEY_REABRIR).apply()
        if (System.currentTimeMillis() - desde > 15 * 60_000L) return
        val abrir = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(abrir) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        runCatching {
            val toque = PendingIntent.getActivity(
                context, ID_ACTUALIZADA, abrir,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val aviso = NotificationCompat.Builder(context, com.dmujeres.app.avisos.AvisosDelDia.CANAL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(context.getString(R.string.ota_actualizada_titulo))
                .setContentText(context.getString(R.string.ota_actualizada_texto))
                .setColor(ContextCompat.getColor(context, R.color.primary_dark))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(toque)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(ID_ACTUALIZADA, aviso)
        }.onFailure { Log.w(TAG, "no se pudo avisar que se actualizó", it) }
    }

    fun quitarAvisoActualizada(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(ID_ACTUALIZADA) }
    }
}

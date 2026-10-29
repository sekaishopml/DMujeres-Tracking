package com.dmujeres.app.actualizacion

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
 * Cada hora el latido pregunta si hay versión nueva y lo anota. Sin jornada y
 * con la app cerrada, en Android 12+ la instala sola sin preguntar. Si no
 * puede, avisa una vez por versión, de 07:00 a 19:00 (nunca de madrugada);
 * además sale en los avisos de horario (ver AvisosHorarios). Al abrir la app
 * o volver a ella, la actualización se abre sola (MainActivity). Después de
 * actualizarse no se avisa nada: ya está al día.
 */
object OtaNotifier {

    private const val TAG = "OtaNotifier"
    private const val KEY_LAST_CHECK = "otaBackgroundCheckAt"
    private const val INTERVAL_MS = 60 * 60_000L

    /** La pantalla principal está a la vista (ella se encarga de actualizar). */
    @Volatile var pantallaAbierta = false

    /** Versión nueva vista y la versión instalada cuando se vio. */
    private const val KEY_DISPONIBLE = "otaDisponible"
    private const val KEY_DISPONIBLE_DESDE = "otaDisponibleDesdeVersion"

    fun maybeCheck(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        if (last in 1..now && now - last < INTERVAL_MS) return
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
        DmujeresApi.checkOta(context) { label, url, sha256 ->
            // Sin jornada y con la app cerrada se instala sola (Android 12+):
            // así se actualizan también los que no abren la app. Con jornada
            // no, para no cortar el registro mientras trabaja.
            if (label != null && !pantallaAbierta) {
                if (!DmujeresApi.isJourneyOpen(context) && com.dmujeres.app.pantallas.UpdateActivity.puedeSinConfirmar(context)) {
                    com.dmujeres.app.pantallas.UpdateActivity.enSegundoPlano(context, url, sha256)
                } else {
                    avisarDisponible(context, label)
                }
            }
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
    private const val ID_DISPONIBLE = 4712
    private const val KEY_AVISADA = "otaVersionAvisada"

    /** Tras actualizarse sola, Android cierra la app: se vuelve a abrir (sin aviso: ya está al día). */
    fun reabrir(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val desde = prefs.getLong(KEY_REABRIR, 0L)
        if (desde == 0L) return
        prefs.edit().remove(KEY_REABRIR).apply()
        quitarAvisoActualizada(context)
        if (System.currentTimeMillis() - desde > 15 * 60_000L) return
        runCatching { context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /**
     * Versión nueva que la app no puede instalar sola ahora (cerrada con la
     * jornada abierta, o sin permiso de instalar): un aviso, una vez por
     * versión. Al tocarlo se abre la app, que se encarga de actualizar.
     */
    private fun avisarDisponible(context: Context, version: String) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        if (prefs.getString(KEY_AVISADA, null) == version) return
        val hora = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("America/Guayaquil")).get(java.util.Calendar.HOUR_OF_DAY)
        if (hora !in 7..18) return
        if (!com.dmujeres.app.sistema.AjustesPermisos.notificaciones(context)) return
        runCatching {
            val abrir = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val toque = PendingIntent.getActivity(context, ID_DISPONIBLE, abrir, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val aviso = NotificationCompat.Builder(context, com.dmujeres.app.avisos.AvisosDelDia.CANAL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(context.getString(R.string.ota_disponible_titulo, version))
                .setContentText(context.getString(R.string.ota_disponible_texto))
                .setColor(ContextCompat.getColor(context, R.color.primary_dark))
                .setContentIntent(toque)
                .setAutoCancel(true)
                .setSound(com.dmujeres.app.avisos.SonidoAvisos.uri(context))
                .build()
            NotificationManagerCompat.from(context).notify(ID_DISPONIBLE, aviso)
            prefs.edit().putString(KEY_AVISADA, version).apply()
        }.onFailure { Log.w(TAG, "no se pudo avisar la versión nueva", it) }
    }

    /** Con la app abierta (o ya actualizada) el aviso de versión nueva sobra. */
    fun quitarAvisoActualizada(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(ID_DISPONIBLE) }
    }
}

package com.dmujeres.app.avisos

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.R
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.sistema.AjustesPermisos

/**
 * Con la jornada abierta, la ubicación apagada o el permiso quitado dejan de
 * registrar el recorrido: eso no espera a la hora fija. Se avisa al momento y
 * una sola vez más si a los 15 min sigue igual; nunca más que eso. Al tocar
 * se abre el ajuste que falta. Se revisa al cambiar la ubicación y con el
 * diagnóstico de cada 10 min.
 */
object AvisoInmediato {

    private const val TAG = "AvisoInmediato"
    private const val ID = 11
    private const val KEY_VECES = "avisoInmediatoVeces"
    private const val KEY_ULTIMO = "avisoInmediatoUltimo"
    private const val REPETIR_MS = 15 * 60_000L
    private const val MAX_AVISOS = 2
    const val KEY_DIAGNOSTICO = "avisoInmediatoDiagnostico"

    fun revisar(context: Context) {
        runCatching {
            val sinPermiso = !AjustesPermisos.ubicacion(context) || !AjustesPermisos.ubicacionSiempre(context)
            val gpsApagado = !gpsEncendido(context)
            if (!DmujeresApi.isJourneyOpen(context) || (!sinPermiso && !gpsApagado)) return limpiar(context)
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            val veces = prefs.getInt(KEY_VECES, 0)
            val ahora = System.currentTimeMillis()
            if (veces >= MAX_AVISOS || (veces > 0 && ahora - prefs.getLong(KEY_ULTIMO, 0L) < REPETIR_MS)) return
            mostrar(context, sinPermiso)
            prefs.edit().putInt(KEY_VECES, veces + 1).putLong(KEY_ULTIMO, ahora)
                .putString(KEY_DIAGNOSTICO, "mostrado ${if (sinPermiso) "permiso" else "gps"} $ahora").apply()
        }.onFailure {
            Log.w(TAG, "no se pudo revisar", it)
            PreferenceManager.getDefaultSharedPreferences(context).edit()
                .putString(KEY_DIAGNOSTICO, "error ${it.javaClass.simpleName}: ${it.message}").apply()
        }
    }

    /** Depuración: muestra el aviso de ubicación apagada tal cual. */
    fun probar(context: Context) = mostrar(context, sinPermiso = false)

    /** Arreglado o sin jornada: se quita el aviso y la cuenta vuelve a cero. */
    fun limpiar(context: Context) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        if (prefs.getInt(KEY_VECES, 0) == 0) return
        prefs.edit().remove(KEY_VECES).remove(KEY_ULTIMO).apply()
        runCatching { NotificationManagerCompat.from(context).cancel(ID) }
    }

    private fun gpsEncendido(context: Context): Boolean = runCatching {
        (context.getSystemService(Context.LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER)
    }.getOrDefault(true)

    private fun mostrar(context: Context, sinPermiso: Boolean) {
        if (!AjustesPermisos.notificaciones(context)) return
        val ajuste = if (sinPermiso) {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        } else {
            Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val abrir = PendingIntent.getActivity(context, ID, ajuste, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notificacion = NotificationCompat.Builder(context, AvisosDelDia.CANAL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(context.getString(if (sinPermiso) R.string.aviso_permiso_titulo else R.string.aviso_gps_titulo))
            .setContentText(context.getString(if (sinPermiso) R.string.aviso_permiso_texto else R.string.aviso_gps_texto))
            .setColor(ContextCompat.getColor(context, R.color.primary_dark))
            .setOnlyAlertOnce(true)
            .setSound(SonidoAvisos.uri(context))
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(ID, notificacion)
    }
}

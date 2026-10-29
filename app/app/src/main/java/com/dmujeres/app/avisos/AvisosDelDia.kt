package com.dmujeres.app.avisos

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.R
import com.dmujeres.app.actualizacion.OtaNotifier
import com.dmujeres.app.cronograma.Actividades
import com.dmujeres.app.pantallas.MainActivity
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.sistema.AjustesPermisos
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Avisos de horario en el teléfono. A las horas de [AvisosHorarios] se revisa
 * el estado y, si algo falta, se muestra una notificación.
 *
 * Lo dispara la alarma propia (funciona sin conexión) o el mensaje que manda
 * el servidor a esa misma hora, lo que llegue primero: cada hora se atiende
 * una sola vez.
 */
object AvisosDelDia {

    private const val TAG = "AvisosDelDia"
    const val CANAL = "avisos"
    private const val ID_NOTIFICACION = 8
    private const val ACCION = "com.dmujeres.app.action.AVISO_HORARIO"
    private const val KEY_ATENDIDA = "avisoHorarioAtendido"
    const val KEY_ULTIMO = "avisoHorarioUltimo"
    private val zona: TimeZone = TimeZone.getTimeZone("America/Guayaquil")

    fun crearCanal(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val canal = NotificationChannel(CANAL, context.getString(R.string.canal_avisos), NotificationManager.IMPORTANCE_HIGH)
        canal.description = context.getString(R.string.canal_avisos_descripcion)
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(canal)
    }

    /** Arma la alarma de la próxima hora de aviso; suena aunque el teléfono esté en reposo. */
    fun programar(context: Context) {
        runCatching {
            val ahora = Calendar.getInstance(zona)
            val minuto = ahora.get(Calendar.HOUR_OF_DAY) * 60 + ahora.get(Calendar.MINUTE)
            val cuando = ahora.timeInMillis - ahora.get(Calendar.SECOND) * 1000L +
                AvisosHorarios.minutosHastaLaProxima(minuto, ahora.get(Calendar.DAY_OF_WEEK)) * 60_000L
            armar(context, ID_NOTIFICACION, Intent(context.applicationContext, Receptor::class.java).setAction(ACCION), cuando)
        }.onFailure { Log.w(TAG, "no se pudo programar el aviso", it) }
    }

    /**
     * Alarma exacta a la hora [cuando]: la hora es fija y la otra se podía
     * atrasar hasta una hora. Sin el permiso de alarmas exactas, la otra.
     */
    fun armar(context: Context, codigo: Int, intent: Intent, cuando: Long) {
        val alarmas = context.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pendiente = PendingIntent.getBroadcast(
            context.applicationContext, codigo, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val exacta = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmas.canScheduleExactAlarms()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && exacta) {
            alarmas.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pendiente)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmas.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pendiente)
        } else {
            alarmas.set(AlarmManager.RTC_WAKEUP, cuando, pendiente)
        }
    }

    /**
     * Atiende la hora que toca, una sola vez. [franjaPedida] es la que manda
     * el servidor ("0800"); sin ella se toma la vigente por el reloj.
     */
    fun atender(context: Context, franjaPedida: String? = null) {
        val ahora = Calendar.getInstance(zona)
        if (!AvisosHorarios.diaHabil(ahora.get(Calendar.DAY_OF_WEEK))) return
        val minuto = ahora.get(Calendar.HOUR_OF_DAY) * 60 + ahora.get(Calendar.MINUTE)
        val pedida = franjaPedida?.takeIf { it.length == 4 }?.let { (it.substring(0, 2).toIntOrNull() ?: -1) * 60 + (it.substring(2).toIntOrNull() ?: 0) }
        val franja = AvisosHorarios.franjaVigente(minuto)?.takeIf { pedida == null || pedida == it } ?: return
        val marca = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }.format(ahora.time) + " " + franja
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        if (prefs.getString(KEY_ATENDIDA, null) == marca) return
        prefs.edit().putString(KEY_ATENDIDA, marca).apply()
        val novedades = AvisosHorarios.novedades(franja, estado(context))
        prefs.edit().putString(KEY_ULTIMO, "$marca · " + if (novedades.isEmpty()) "sin novedades" else novedades.joinToString { it.name }).apply()
        if (novedades.isNotEmpty()) mostrar(context, novedades)
    }

    /** Lo que el teléfono sabe de sí mismo ahora. */
    fun estado(context: Context): AvisosHorarios.Estado {
        val hoy = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }.format(System.currentTimeMillis())
        val gps = runCatching {
            (context.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager)
                .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        }.getOrDefault(true)
        val restringida = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && runCatching {
            !(context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                .isIgnoringBatteryOptimizations(context.packageName)
        }.getOrDefault(false)
        return AvisosHorarios.Estado(
            jornadaAbierta = DmujeresApi.isJourneyOpen(context),
            gpsEncendido = gps,
            permisoUbicacion = AjustesPermisos.ubicacion(context),
            permisoTodoElTiempo = AjustesPermisos.ubicacionSiempre(context),
            bateriaRestringida = restringida,
            hayActualizacion = OtaNotifier.hayActualizacion(context),
            tiposDeHoy = Actividades.delDia(context, hoy).map { it.tipo }.toSet(),
        )
    }

    fun texto(context: Context, novedad: AvisosHorarios.Novedad): String = context.getString(
        when (novedad) {
            AvisosHorarios.Novedad.SIN_JORNADA -> R.string.aviso_h_sin_jornada
            AvisosHorarios.Novedad.PERMISO_QUITADO -> R.string.aviso_h_permiso
            AvisosHorarios.Novedad.ACTUALIZAR -> R.string.aviso_h_actualizar
        },
    )

    /** Muestra la notificación con una o varias novedades; al tocarla abre la app. */
    fun mostrar(context: Context, novedades: List<AvisosHorarios.Novedad>) {
        if (!AjustesPermisos.notificaciones(context)) return
        runCatching {
            val abrir = PendingIntent.getActivity(
                context, ID_NOTIFICACION,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val lineas = novedades.map { texto(context, it) }
            val titulo = context.getString(
                when (novedades.singleOrNull()) {
                    AvisosHorarios.Novedad.SIN_JORNADA -> R.string.aviso_h_titulo_jornada
                    AvisosHorarios.Novedad.ACTUALIZAR -> R.string.aviso_h_titulo_actualizar
                    else -> R.string.aviso_h_titulo
                },
            )
            val notificacion = NotificationCompat.Builder(context, CANAL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(titulo)
                .setContentText(lineas.first())
                .setStyle(NotificationCompat.BigTextStyle().bigText(lineas.joinToString("\n")))
                .setColor(ContextCompat.getColor(context, R.color.primary_dark))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(abrir)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(ID_NOTIFICACION, notificacion)
        }.onFailure { Log.w(TAG, "no se pudo mostrar el aviso", it) }
    }

    /** La alarma propia: atiende la hora y deja armada la siguiente. */
    class Receptor : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACCION) return
            runCatching { atender(context) }
            programar(context)
        }
    }
}

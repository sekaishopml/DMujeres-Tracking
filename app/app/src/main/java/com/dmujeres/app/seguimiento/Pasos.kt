package com.dmujeres.app.seguimiento

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.preference.PreferenceManager
import com.dmujeres.app.sistema.AjustesPermisos

/**
 * Pasos de la jornada, con el contador del propio teléfono. Sirve para
 * comprobar que el teléfono va con una persona: un recorrido largo sin un solo
 * paso no es de alguien caminando (puede ir en vehículo o el teléfono estar
 * solo). Solo se guarda el total de la jornada, no la actividad minuto a minuto.
 *
 * El contador del sistema cuenta desde que se encendió el teléfono: se guarda
 * la última lectura y se suma la diferencia; si baja, el teléfono se reinició y
 * se cuenta desde cero.
 */
class Pasos(private val context: Context) : SensorEventListener {
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor: Sensor? = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private val prefs = PreferenceManager.getDefaultSharedPreferences(context)

    private var activo = false

    fun iniciar() {
        if (activo || sensor == null || !AjustesPermisos.actividadFisica(context)) return
        activo = true
        // Las lecturas se agrupan hasta 5 minutos: casi no gasta batería.
        runCatching { manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, 5 * 60_000_000) }
    }

    fun detener() {
        activo = false
        runCatching { manager.unregisterListener(this) }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val lectura = event.values.firstOrNull()?.toLong() ?: return
        val anterior = prefs.getLong(KEY_ULTIMA_LECTURA, -1L)
        val suma = when {
            anterior < 0 -> 0L
            lectura >= anterior -> lectura - anterior
            else -> lectura
        }
        val editor = prefs.edit().putLong(KEY_ULTIMA_LECTURA, lectura)
        if (suma > 0 && com.dmujeres.app.red.DmujeresApi.isJourneyOpen(context)) {
            editor.putLong(KEY_PASOS, prefs.getLong(KEY_PASOS, 0L) + suma)
        }
        editor.apply()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    companion object {
        private const val KEY_PASOS = "pasosJornada"
        private const val KEY_ULTIMA_LECTURA = "pasosUltimaLectura"

        /** Pasos de la jornada abierta (0 si no hay). */
        fun deLaJornada(context: Context): Long =
            PreferenceManager.getDefaultSharedPreferences(context).getLong(KEY_PASOS, 0L)

        /** Empieza la cuenta de una jornada nueva. */
        fun reiniciar(context: Context) {
            PreferenceManager.getDefaultSharedPreferences(context).edit().putLong(KEY_PASOS, 0L).apply()
        }

        /** ¿Este teléfono tiene contador de pasos? Una tablet barata puede no tenerlo. */
        fun disponible(context: Context): Boolean =
            (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager)
                .getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
    }
}

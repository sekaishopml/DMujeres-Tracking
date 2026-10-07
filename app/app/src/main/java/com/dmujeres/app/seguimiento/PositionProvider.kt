/*
 * Copyright 2013 - 2022 Anton Tananaev (anton@traccar.org)
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
package com.dmujeres.app.seguimiento

import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.sistema.BatteryStatus
import com.dmujeres.app.sistema.readBatteryStatus
import kotlin.math.abs

abstract class PositionProvider(
    protected val context: Context,
    protected val listener: PositionListener,
) {

    interface PositionListener {
        fun onPositionUpdate(position: Position)
        fun onPositionError(error: Throwable)
    }

    protected var preferences: SharedPreferences = PreferenceManager.getDefaultSharedPreferences(context)
    protected var deviceId = preferences.getString(Prefs.DEVICE, "undefined")!!.lowercase()
    protected var distance: Double = preferences.getString(Prefs.DISTANCE, "10")!!.toInt().toDouble()
    protected var angle: Double = preferences.getString(Prefs.ANGLE, "15")!!.toInt().toDouble()
    private var lastLocation: Location? = null

    /**
     * Intervalo de reporte efectivo (ms). Lo ajusta la cadencia adaptativa:
     * corto en movimiento (trazo fino) y largo en quietud (sin ruido).
     */
    @Volatile
    var reportIntervalMs: Long = AdaptiveCadence.MOVING_INTERVAL_MS

    /** Nombre del proveedor vigente (para el campo `provider` del evento). */
    open val providerName: String = "gps"

    abstract fun startUpdates()
    abstract fun stopUpdates()
    abstract fun requestSingleLocation()

    /**
     * Ubicación NUEVA para los rescates (alarma, push, encendido); nunca la
     * última conocida, que repetiría el punto de antes del hueco. Cada
     * proveedor la pide con su función de "posición actual".
     */
    open fun requestFreshLocation() {
        requestSingleLocation()
    }

    /**
     * Estado que fija TrackingController: `moving` ajusta cada cuánto se
     * reporta y `gpsContinuous` (jornada abierta) decide cómo se pide el GPS.
     * Solo se vuelve a pedir el GPS cuando cambia `gpsContinuous`; pasar de
     * moverse a quieta no lo reinicia.
     */
    abstract fun applyMotionState(moving: Boolean, gpsContinuous: Boolean)

    /** Alinea el filtro temporal del reporte con la cadencia del estado. */
    protected fun updateReportInterval(moving: Boolean) {
        reportIntervalMs = if (moving) {
            AdaptiveCadence.movingIntervalMs(configuredIntervalSeconds())
        } else {
            AdaptiveCadence.STATIONARY_INTERVAL_MS
        }
    }

    /** Frecuencia configurada en el panel (`mobile.intervalSeconds`), o null. */
    protected fun configuredIntervalSeconds(): Long? =
        preferences.getString(Prefs.INTERVAL, null)?.toLongOrNull()

    protected fun processLocation(location: Location?) {
        val lastLocation = this.lastLocation
        // Guardas anti-ruido para el filtro de ángulo: quieto, el rumbo del GPS
        // salta aleatoriamente y sin estas condiciones se enviaba un punto en
        // cada fix (telaraña en el replay con el equipo detenido).
        val leg = if (lastLocation != null && location != null) {
            location.distanceTo(lastLocation).toDouble()
        } else {
            0.0
        }
        val dtSeconds = if (lastLocation != null && location != null) {
            (location.time - lastLocation.time) / 1000.0
        } else {
            0.0
        }
        val impliedSpeed = if (dtSeconds > 0) leg / dtSeconds else 0.0
        // Si el sensor dice quieta y no se movió ni 10 m desde el último punto,
        // la velocidad es 0 (el ruido del GPS no la marca "en línea"). Si se
        // movió, va la velocidad real aunque el sensor no lo haya notado.
        if (location != null && MotionMonitor.isMoving() == false && leg < MIN_LEG_FOR_SPEED_M) {
            location.speed = 0f
        }
        if (location != null &&
            (lastLocation == null || location.time - lastLocation.time >= reportIntervalMs || distance > 0
                    && leg >= distance || angle > 0
                    && leg >= ANGLE_MIN_LEG_M && impliedSpeed >= ANGLE_MIN_SPEED_MPS
                    && abs(location.bearing - lastLocation.bearing) >= angle)
        ) {
            Log.i(TAG, "location new")
            // Muchos teléfonos mandan velocidad 0 o nada aunque la persona se
            // mueva. Si el desplazamiento desde el último punto supera el
            // error del GPS, se usa la velocidad calculada.
            val sinVelocidad = !location.hasSpeed() || location.speed < 0.3f
            if (lastLocation != null && sinVelocidad) {
                val implied = SpeedFallback.impliedSpeedMps(
                    legMeters = leg,
                    dtSeconds = dtSeconds,
                    accuracyMeters = if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0,
                )
                if (implied != null) location.speed = implied.toFloat()
            }
            preferences.edit()
                .putLong(KEY_LAST_FIX_AT, System.currentTimeMillis())
                // Último fix para el cronograma (ubicación al registrar una actividad).
                .putString(KEY_LAST_FIX_LAT, location.latitude.toString())
                .putString(KEY_LAST_FIX_LON, location.longitude.toString())
                .putFloat(KEY_LAST_FIX_ACC, if (location.hasAccuracy()) location.accuracy else -1f)
                .apply()
            this.lastLocation = location
            listener.onPositionUpdate(Position(deviceId, location, getBatteryStatus(context)))
        } else {
            Log.i(TAG, if (location != null) "location ignored" else "location nil")
        }
    }

    protected fun getBatteryStatus(context: Context): BatteryStatus = readBatteryStatus(context)

    companion object {
        private val TAG = PositionProvider::class.java.simpleName

        /** Hora del último fix aceptado (para el refresco progresivo). */
        const val KEY_LAST_FIX_AT = "lastFixAt"
        const val KEY_LAST_FIX_LAT = "lastFixLat"
        const val KEY_LAST_FIX_LON = "lastFixLon"
        const val KEY_LAST_FIX_ACC = "lastFixAcc"

        /**
         * Tramo mínimo (m) para que un giro cuente: filtra el temblor y toma
         * esquinas de 90° antes de los 10 m del filtro de distancia.
         */
        const val ANGLE_MIN_LEG_M = 8.0

        /** Velocidad implícita mínima (m/s) para que el giro cuente. */
        const val ANGLE_MIN_SPEED_MPS = 1.5

        /** Bajo esta pata (m) el equipo se considera realmente quieto (velocidad 0). */
        const val MIN_LEG_FOR_SPEED_M = 10.0
    }

}

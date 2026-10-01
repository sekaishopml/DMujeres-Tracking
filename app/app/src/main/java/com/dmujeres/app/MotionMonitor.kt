package com.dmujeres.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.util.Log
import kotlin.math.sqrt

/**
 * Acelerómetro y giroscopio, con una ventana deslizante y margen para no
 * cambiar de estado a cada rato.
 *
 * Solo da pistas de movimiento (nunca coordenadas): sirve para empezar a
 * registrar en cuanto el teléfono se mueve y para no reportar temblor cuando
 * está quieto.
 *
 * - Desviación de la aceleración: menos de 0,15 m/s² es quieto, 0,6 o más es
 *   movimiento; en el medio se mantiene el estado.
 * - El giroscopio solo se usa con el teléfono en movimiento (ahorra batería),
 *   para detectar giros fuertes ([TurnDetector]) y guardar las esquinas.
 */
object MotionMonitor : SensorEventListener {

    enum class State { STATIONARY, MOVING, UNKNOWN }

    /** Aviso de giro fuerte: el controlador pide un fix extra. */
    interface TurnListener {
        fun onTurn()
    }

    private const val TAG = "MotionMonitor"
    private const val WINDOW = 24
    private const val MIN_SAMPLES = 12
    private const val STATIONARY_STD = 0.15
    private const val MOVING_STD = 0.6

    private val magnitudes = ArrayDeque<Double>()
    private val turnDetector = TurnDetector()

    private var sensorManager: SensorManager? = null

    @Volatile
    private var state = State.UNKNOWN

    @Volatile
    private var registered = false

    @Volatile
    private var gyroRegistered = false

    /** Velocidad del último fix reportado (nudos); la usa el detector de giros. */
    @Volatile
    var lastSpeedKnots: Double = 0.0

    @Volatile
    private var turnListener: TurnListener? = null

    /** Aviso de arranque de movimiento (sensor significant motion, bajo consumo). */
    fun interface SignificantMotionListener {
        fun onSignificantMotion()
    }

    @Volatile
    private var significantMotionListener: SignificantMotionListener? = null

    private var significantMotionTrigger: android.hardware.TriggerEventListener? = null

    fun setSignificantMotionListener(listener: SignificantMotionListener?) {
        significantMotionListener = listener
    }

    /** true/false si se sabe; null si no hay datos suficientes. */
    fun isMoving(): Boolean? = when (state) {
        State.MOVING -> true
        State.STATIONARY -> false
        State.UNKNOWN -> null
    }

    fun setTurnListener(listener: TurnListener?) {
        turnListener = listener
    }

    fun register(context: Context) {
        if (registered) return
        runCatching {
            val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
            sensorManager = manager
            manager.registerListener(this, manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), SensorManager.SENSOR_DELAY_NORMAL)
            registered = true
            updateGyroscope()
            armSignificantMotion()
            Log.i(TAG, "acelerómetro registrado")
        }.onFailure { Log.w(TAG, "no se pudieron registrar los sensores", it) }
    }

    fun unregister(context: Context) {
        if (!registered) return
        runCatching {
            val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
            significantMotionTrigger?.let { manager.cancelTriggerSensor(it, manager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)) }
            manager.unregisterListener(this)
        }
        significantMotionTrigger = null
        significantMotionListener = null
        registered = false
        gyroRegistered = false
        sensorManager = null
        magnitudes.clear()
        state = State.UNKNOWN
        turnDetector.reset()
        turnListener = null
        lastSpeedKnots = 0.0
    }

    /**
     * Sensor de "movimiento significativo" (avisa una vez y casi no gasta):
     * avisa apenas el teléfono empieza a moverse aunque el acelerómetro no lo
     * note. Se vuelve a activar después de cada aviso.
     */
    private fun armSignificantMotion() {
        if (!registered) return
        // El trigger cambió de firma en Android 14 (TriggerEvent); en equipos
        // anteriores el acelerómetro + la red de velocidad ya cubren el arranque.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        val manager = sensorManager ?: return
        val sensor = manager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) ?: return
        val trigger = object : android.hardware.TriggerEventListener() {
            override fun onTrigger(event: android.hardware.TriggerEvent) {
                significantMotionTrigger = null
                val callback = significantMotionListener
                if (callback != null) {
                    callback.onSignificantMotion()
                    armSignificantMotion()
                }
            }
        }
        runCatching {
            if (manager.requestTriggerSensor(trigger, sensor)) {
                significantMotionTrigger = trigger
            }
        }.onFailure { Log.w(TAG, "sin sensor de movimiento significativo", it) }
    }

    /** El giroscopio solo se enciende con el equipo en movimiento (ahorro). */
    private fun updateGyroscope() {
        val manager = sensorManager ?: return
        val gyro = manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) ?: return
        val movingNow = state == State.MOVING
        if (movingNow && !gyroRegistered) {
            manager.registerListener(this, gyro, SensorManager.SENSOR_DELAY_NORMAL)
            gyroRegistered = true
        } else if (!movingNow && gyroRegistered) {
            manager.unregisterListener(this, gyro)
            gyroRegistered = false
            turnDetector.reset()
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> onAccelerometer(event)
            Sensor.TYPE_GYROSCOPE -> onGyroscope(event)
        }
    }

    private fun onAccelerometer(event: SensorEvent) {
        val magnitude = sqrt(
            event.values[0] * event.values[0] +
                event.values[1] * event.values[1] +
                event.values[2] * event.values[2],
        ).toDouble()
        magnitudes.addLast(magnitude)
        if (magnitudes.size > WINDOW) magnitudes.removeFirst()
        if (magnitudes.size < MIN_SAMPLES) return
        val mean = magnitudes.average()
        val variance = magnitudes.sumOf { (it - mean) * (it - mean) } / magnitudes.size
        val std = sqrt(variance)
        state = when {
            std >= MOVING_STD -> State.MOVING
            std <= STATIONARY_STD -> State.STATIONARY
            else -> state // zona de histéresis: se conserva el estado previo
        }
        updateGyroscope()
    }

    private fun onGyroscope(event: SensorEvent) {
        val magnitude = sqrt(
            event.values[0] * event.values[0] +
                event.values[1] * event.values[1] +
                event.values[2] * event.values[2],
        ).toDouble()
        // Giro fuerte con el vehículo en marcha: aviso para capturar la esquina.
        if (turnDetector.onSample(Math.toDegrees(magnitude), lastSpeedKnots, System.currentTimeMillis())) {
            turnListener?.onTurn()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}

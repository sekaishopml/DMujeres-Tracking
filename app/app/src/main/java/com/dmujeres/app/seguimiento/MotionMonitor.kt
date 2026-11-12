package com.dmujeres.app.seguimiento

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
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
 * - 20 s seguidos de movimiento avisan el arranque ([ArranqueSostenido]),
 *   igual que el sensor de movimiento significativo o la actividad de Google.
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
    private val arranque = ArranqueSostenido()

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

    /**
     * El reconocimiento de actividad dice "en vehículo" o "a pie": cuenta como
     * arranque igual que el sensor. Quieta, la app guarda un punto cada 2 min
     * y la salida se notaba tarde.
     */
    fun avisarMovimiento() {
        significantMotionListener?.onSignificantMotion()
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
            // Por tandas: el chip de sensores junta 5 s de lecturas y despierta al
            // teléfono una vez, no cinco por segundo (el ZTE marcaba la app por
            // "consumo del sensor"). Las muestras conservan su hora real.
            manager.registerListener(
                this,
                manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER),
                SensorManager.SENSOR_DELAY_NORMAL,
                TANDA_ACELEROMETRO_US,
            )
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
        arranque.reiniciar()
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
        // Es el único sensor que despierta al teléfono dormido en el bolsillo:
        // se usa en todas las versiones (antes solo desde Android 14).
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
        if (arranque.muestra(horaDeMuestra(event.timestamp), state == State.MOVING)) {
            Log.i(TAG, "movimiento sostenido del acelerómetro: arranque")
            significantMotionListener?.onSignificantMotion()
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

    /** Hora de reloj de una muestra (llegan en tandas de hasta 5 s de atraso). */
    private fun horaDeMuestra(timestampNs: Long): Long =
        horaDeMuestra(System.currentTimeMillis(), android.os.SystemClock.elapsedRealtimeNanos(), timestampNs)

    private const val TANDA_ACELEROMETRO_US = 5_000_000

    /** Si la hora del sensor no es creíble (otra base de tiempo), se usa la de llegada. */
    internal fun horaDeMuestra(ahoraMs: Long, ahoraNs: Long, timestampNs: Long): Long {
        val atrasoMs = (ahoraNs - timestampNs) / 1_000_000
        return if (atrasoMs in 0..60_000) ahoraMs - atrasoMs else ahoraMs
    }
}

package com.dmujeres.app.movimiento

import com.dmujeres.app.captura.WalkDetector
import com.dmujeres.app.seguimiento.MotionMonitor

/**
 * Máquina de estados de movimiento (sin Android, se prueba en la JVM).
 *
 * Decidir si la persona se mueve solo con el acelerómetro no sirve: en un
 * viaje a velocidad constante el sensor parece quieto y la app bajaba a un
 * punto cada 120 s. Esta máquina junta varias señales por orden de
 * importancia y, si no hay datos, captura seguido en vez de espaciar.
 *
 * Orden de las señales:
 * 1. Velocidad del GPS de 3 nudos o más: manda siempre.
+ * 1b. Caminata (avance neto 2-8 km/h sostenido 3 min): también es movimiento,
+ *     aunque la instantánea quede bajo 3 kn; nunca se degrada a STATIONARY
+ *     mientras haya avance sostenido.
 * 2. Desplazamiento acumulado entre puntos de 150 m o más: cubre los
 *    teléfonos que reportan velocidad 0.
 * 3. Movimiento significativo o giro: arranque.
 * 4. Acelerómetro ([MotionMonitor]): última pista, nunca decide solo.
 * 5. Lo guardado: para retomar después de que el sistema cierre la app.
 *
 * Reglas de tiempo:
 * - Para pasar a STATIONARY hacen falta 3 min seguidos de quietud.
 * - Sin puntos nuevos no se espacia la captura; a los 4 min se pasa a
 *   RECOVERING (se vuelve a pedir el GPS, se prueba el del sistema, alarma).
 * - Si el sensor no sabe (UNKNOWN), se trata como ACTIVE.
 */
class MovementStateMachine {

    /** Estados de la arquitectura cerrada (§6). */
    enum class State {
        STOPPED,
        STARTING,
        ACTIVE,
        STATIONARY,
        DEGRADED,
        RECOVERING,
    }

    /**
     * Muestra mínima del historial persistido para reconstruir el estado tras
     * recrear el proceso (nunca "en memoria = válido").
     */
    data class FixSample(
        val atMs: Long,
        val speedKn: Double,
        val displacementM: Double,
    )

    var state: State = State.STOPPED
        private set

    /** Cuándo empezó la evidencia consistente de quietud (para los 3 min). */
    private var stillSinceMs: Long = -1L

    /** Último fix aceptado (para los 4 min sin fix). */
    private var lastFixAtMs: Long = -1L

    /** Último momento con evidencia de movimiento. */
    private var lastMotionAtMs: Long = -1L

    /**
     * Avance lento pero constante (caminata), con cada punto que trae
     * coordenadas ([onFixWithPosition]). Mientras haya avance la máquina no
     * pasa a STATIONARY aunque la velocidad sea menor a 3 nudos.
     */
    private val walkDetector = WalkDetector()

    /** ¿El avance acumulado indica que está caminando? (para el panel). */
    val isWalking: Boolean
        get() = walkDetector.walking

    // --- Ciclo de jornada ---------------------------------------------------

    /** La jornada siempre nace de una acción visible del usuario. */
    fun onJourneyStarted(nowMs: Long): State {
        state = State.STARTING
        stillSinceMs = -1L
        lastFixAtMs = -1L
        lastMotionAtMs = nowMs
        walkDetector.reset()
        return state
    }

    fun onJourneyStopped(): State {
        state = State.STOPPED
        stillSinceMs = -1L
        lastFixAtMs = -1L
        lastMotionAtMs = -1L
        walkDetector.reset()
        return state
    }

    /**
     * Alinea la máquina con la jornada guardada. La app arranca el servicio al
     * abrirse con la jornada cerrada (STOPPED); si después se tocaba "Iniciar
     * jornada" la máquina seguía en STOPPED todo el día. El controlador llama
     * esto en cada pulso y en cada onStartCommand. Devuelve true si cambió
     * el estado.
     */
    fun syncJourney(nowMs: Long, journeyOpen: Boolean): Boolean {
        if (journeyOpen && state == State.STOPPED) {
            onJourneyStarted(nowMs)
            return true
        }
        if (!journeyOpen && state != State.STOPPED) {
            onJourneyStopped()
            return true
        }
        return false
    }

    // --- Entradas ------------------------------------------------------------

    /**
     * Punto de GPS aceptado.
     *
     * @param speedKn velocidad que reporta el GPS (nudos).
     * @param displacementM distancia desde el último punto aceptado (m).
     * @param imuMoving acelerómetro: true/false, null si no hay datos.
     * @param significantMotion aviso del sensor de movimiento significativo.
     */
    fun onFix(
        nowMs: Long,
        speedKn: Double,
        displacementM: Double,
        imuMoving: Boolean?,
        significantMotion: Boolean = false,
    ): State = onFixInternal(nowMs, speedKn, displacementM, imuMoving, significantMotion, isWalking)

    /**
     * Punto de GPS aceptado con coordenadas: hace lo mismo que [onFix] y
     * además suma el avance para detectar caminata. Es la que usa el
     * controlador; [onFix] queda para las pruebas.
     */
    fun onFixWithPosition(
        nowMs: Long,
        speedKn: Double,
        displacementM: Double,
        latitude: Double,
        longitude: Double,
        imuMoving: Boolean?,
        significantMotion: Boolean = false,
    ): State {
        if (state == State.STOPPED) return state
        val walking = walkDetector.add(nowMs, latitude, longitude)
        return onFixInternal(nowMs, speedKn, displacementM, imuMoving, significantMotion, walking)
    }

    private fun onFixInternal(
        nowMs: Long,
        speedKn: Double,
        displacementM: Double,
        imuMoving: Boolean?,
        significantMotion: Boolean,
        walking: Boolean,
    ): State {
        if (state == State.STOPPED) return state
        lastFixAtMs = nowMs
        val moving = isMovingEvidence(speedKn, displacementM, imuMoving, significantMotion, walking)
        if (moving) {
            lastMotionAtMs = nowMs
            stillSinceMs = -1L
            // Cualquier evidencia de movimiento captura en fino.
            state = State.ACTIVE
        } else {
            // Parece quieta: solo cuenta si el GPS no dice lo contrario (el
            // acelerómetro nunca contradice al GPS) y se sostiene 3 min. El
            // primer punto siempre pasa de STARTING a ACTIVE.
            if (stillSinceMs < 0L) stillSinceMs = nowMs
            if (state == State.STARTING) {
                state = State.ACTIVE
            } else if (state == State.ACTIVE || state == State.RECOVERING) {
                if (nowMs - stillSinceMs >= STATIONARY_AFTER_MS) {
                    state = State.STATIONARY
                }
            }
        }
        return state
    }

    /**
     * Pulso del acelerómetro entre puntos: una pista más. Si dice que se mueve
     * se captura más seguido; si dice que está quieta no se espacia (manda el
     * GPS).
     */
    fun onImuHint(nowMs: Long, imuMoving: Boolean?): State {
        if (state == State.STOPPED) return state
        if (imuMoving == true) {
            lastMotionAtMs = nowMs
            stillSinceMs = -1L
            if (state == State.STATIONARY || state == State.STARTING) {
                state = State.ACTIVE
            }
        }
        return state
    }

    /** Aviso one-shot del sensor de movimiento significativo: arranca ruta. */
    fun onSignificantMotion(nowMs: Long): State {
        if (state == State.STOPPED) return state
        lastMotionAtMs = nowMs
        stillSinceMs = -1L
        if (state != State.ACTIVE) state = State.ACTIVE
        return state
    }

    /**
     * Reloj (el controlador lo llama cada minuto): cambios que dependen solo
     * del tiempo. Sin puntos nuevos nunca se pasa a STATIONARY; a los 4 min
     * sin puntos se pide rescate.
     */
    fun onTick(nowMs: Long): State {
        if (state == State.STOPPED || state == State.STARTING) return state
        // Sin puntos nuevos el avance viejo deja de contar como caminata.
        walkDetector.evict(nowMs)
        // lastFixAtMs >= 0: hubo al menos un fix (el 0L es válido en tests; en
        // producción los epoch reales nunca son 0; -1L = sin fix aún).
        if (lastFixAtMs >= 0L && nowMs - lastFixAtMs >= NO_FIX_RECOVER_MS) {
            if (state == State.ACTIVE || state == State.STATIONARY || state == State.DEGRADED) {
                state = State.RECOVERING
            }
        }
        return state
    }

    /** GPS apagado, sin permiso o sin proveedor: degradado, no detenido. */
    fun onPositionUnavailable(): State {
        if (state != State.STOPPED) state = State.DEGRADED
        return state
    }

    /** Pedido de recuperación (alarma, push, encendido, red): rescatar. */
    fun onRecoveryTriggered(nowMs: Long): State {
        if (state == State.STOPPED) return state
        if (state == State.ACTIVE || state == State.STATIONARY || state == State.DEGRADED) {
            state = State.RECOVERING
            // Al recuperar se arranca en fino hasta tener evidencia (3 min).
            stillSinceMs = -1L
            lastMotionAtMs = nowMs
            // El avance de antes del hueco ya no dice nada de ahora.
            walkDetector.reset()
        }
        return state
    }

    /**
     * La recuperación termina cuando hay fix fresco Y la cola fluye: entonces
     * se vuelve a ACTIVE-seguro (la evidencia posterior dirá si es STATIONARY).
     */
    fun onRecovered(nowMs: Long, queueFlowing: Boolean): State {
        if (state == State.RECOVERING && queueFlowing) {
            state = State.ACTIVE
            lastFixAtMs = nowMs
            lastMotionAtMs = nowMs
            stillSinceMs = -1L
        }
        return state
    }

    // --- Reconstrucción -------------------------------------------------------

    /**
     * Reconstruye el estado desde lo guardado cuando el sistema recrea la app.
     * Sin historial se arranca en ACTIVE por 3 min (nunca se supone quietud
     * sin pruebas). Con historial reciente en movimiento sigue en ACTIVE; si
     * todo está quieto desde hace 3 min o más, STATIONARY.
     */
    fun restore(nowMs: Long, journeyOpen: Boolean, history: List<FixSample>): State {
        // Lo guardado no trae coordenadas: el avance se vuelve a calcular con
        // los primeros puntos.
        walkDetector.reset()
        if (!journeyOpen) {
            state = State.STOPPED
            return state
        }
        if (history.isEmpty()) {
            // Sin datos: captura seguida.
            state = State.ACTIVE
            lastFixAtMs = -1L
            stillSinceMs = nowMs
            lastMotionAtMs = nowMs
            return state
        }
        val recent = history.filter { nowMs - it.atMs <= HISTORY_WINDOW_MS }
        if (recent.isEmpty()) {
            // Historial viejo (por ejemplo, reinicio hace horas): rescate.
            state = State.RECOVERING
            lastFixAtMs = -1L
            stillSinceMs = -1L
            return state
        }
        val moving = recent.any { it.speedKn >= MOVING_SPEED_KN || it.displacementM >= MOVING_DISTANCE_M }
        val oldestRecent = recent.minOf { it.atMs }
        lastFixAtMs = recent.maxOf { it.atMs }
        if (moving) {
            state = State.ACTIVE
            lastMotionAtMs = lastFixAtMs
            stillSinceMs = -1L
        } else if (nowMs - oldestRecent >= STATIONARY_AFTER_MS) {
            state = State.STATIONARY
            stillSinceMs = oldestRecent
        } else {
            // Quietud breve sin 3 min de evidencia: fino y seguro.
            state = State.ACTIVE
            stillSinceMs = oldestRecent
            lastMotionAtMs = nowMs
        }
        return state
    }

    /** ¿La cadencia debe ser fina? Todo salvo STATIONARY/STOPPED captura fino. */
    fun wantsFineCadence(): Boolean = when (state) {
        State.ACTIVE, State.STARTING, State.DEGRADED, State.RECOVERING -> true
        State.STATIONARY, State.STOPPED -> false
    }

    private fun isMovingEvidence(
        speedKn: Double,
        displacementM: Double,
        imuMoving: Boolean?,
        significantMotion: Boolean,
        walking: Boolean,
    ): Boolean {
        // 1. El GPS manda siempre. 1b. La caminata (avance bajo pero sostenido)
        // también es movimiento: nunca se degrada a STATIONARY por velocidad
        // instantánea <3 kn mientras haya avance. 2. El desplazamiento suple
        // velocidad nula. 3. El sensor significativo arranca ruta. 4. El IMU
        // es el último indicio: suma, pero su UNKNOWN (null) nunca resta.
        if (speedKn >= MOVING_SPEED_KN) return true
        if (walking) return true
        if (displacementM >= MOVING_DISTANCE_M) return true
        if (significantMotion) return true
        return imuMoving == true
    }

    companion object {
        /** Velocidad GPS (kn) desde la que hay movimiento real. */
        const val MOVING_SPEED_KN = 3.0

        /** Desplazamiento (m) que suple una velocidad nula. */
        const val MOVING_DISTANCE_M = 150.0

        /** STATIONARY exige 3 min de evidencia consistente. */
        const val STATIONARY_AFTER_MS = 3 * 60_000L

        /** Sin fix 4 min se pide rescate (igual que el watchdog). */
        const val NO_FIX_RECOVER_MS = 4 * 60_000L

        /** Ventana del historial que cuenta para reconstruir. */
        const val HISTORY_WINDOW_MS = 10 * 60_000L
    }
}

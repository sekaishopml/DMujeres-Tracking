/*
 * Copyright 2015 - 2021 Anton Tananaev (anton@traccar.org)
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
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.R
import com.dmujeres.app.captura.CaptureGate
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.datos.DatabaseHelper.DatabaseHandler
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.envio.UploadQueue
import com.dmujeres.app.jornada.JourneyManager
import com.dmujeres.app.movimiento.MovementStateMachine
import com.dmujeres.app.pantallas.StatusActivity
import com.dmujeres.app.recuperacion.DozeAlarmReceiver
import com.dmujeres.app.red.ConnectionState
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.red.NetworkManager
import com.dmujeres.app.red.NetworkManager.NetworkHandler
import com.dmujeres.app.red.ProtocolFormatter.formatRequest
import com.dmujeres.app.red.RequestManager.RequestHandler
import com.dmujeres.app.red.RequestManager.sendRequestAsync
import com.dmujeres.app.red.UploadThrottle
import com.dmujeres.app.seguimiento.PositionProvider.PositionListener
import com.dmujeres.app.sesion.SessionCloser
import com.dmujeres.app.sistema.PowerEvents
import com.dmujeres.app.sistema.SendWakeLock

/**
 * Único lugar que manda en el registro: captura, máquina de estados, cola y
 * recuperación pasan por aquí. Ningún otro componente manda sobre la cadencia.
 */
private const val CONSOLE_FIX_GAP_MS = 20_000L

class TrackingController(private val context: Context) :
    PositionListener, NetworkHandler, MotionMonitor.TurnListener, UploadQueue.Listener {

    private val handler = Handler(Looper.getMainLooper())
    private val preferences = PreferenceManager.getDefaultSharedPreferences(context)
    private var positionProvider = PositionProviderFactory.create(context, this)
    private val watchdog = LocationWatchdog()

    /**
     * Máquina de estados de movimiento: es la que decide cada cuánto se pide
     * ubicación. El sensor de movimiento (MotionMonitor) es solo una pista
     * más; mandan la velocidad del GPS y el desplazamiento.
     */
    private val machine = MovementStateMachine()
    private val journeyManager = JourneyManager(context)
    private var uploadQueue: UploadQueue? = null
    /**
     * Filtros de captura (teleport, colapso en parado, giro): deciden si cada
     * fix se almacena, sin tocar cadencia, protocolo, jornada ni recuperación.
     * Con estado propio (último almacenado/aceptado), sembrado del historial.
     */
    private val captureGate = CaptureGate()

    /** Despertador de movimiento fuera del proceso (geocerca de quietud). */
    private val stationaryFence: StationaryFence =
        runCatching { StationaryFenceFactory.create(context) }.getOrDefault(NoStationaryFence)
    private var fenceArmed = false

    /** Latido fino vigente (se aplica al proveedor solo al cambiar). */
    private var fineCadence = true
    /** GPS continuo: con jornada abierta, en todos los estados menos STOPPED. */
    private var gpsContinuous = true
    private var platformFallback = false

    private var lastFixLat = 0.0
    private var lastFixLon = 0.0
    private var lastFixAtMs = 0L
    /**
     * Último punto GUARDADO (hora y coordenadas exactas) para
     * [DuplicateFixGuard]. No es el último recibido (`lastFix*`): solo avanza
     * cuando el punto entra a la base, nunca con un duplicado descartado.
     */
    private var lastStoredFix: DuplicateFixGuard.Fix? = null
    /** Aviso significant-motion pendiente de consumir en el próximo fix. */
    private var significantMotionPending = false
    private val databaseHelper = DatabaseHelper(context)
    private val networkManager = NetworkManager(context, this)

    private val url: String = preferences.getString(Prefs.URL, context.getString(R.string.settings_url_default_value))!!
    private val buffer: Boolean = preferences.getBoolean(Prefs.BUFFER, true)

    /** Interruptor del wake lock por envío (la preferencia sigue mandando). */
    private val wakeLockEnabled: Boolean = preferences.getBoolean(Prefs.WAKELOCK, true)

    private var isOnline = networkManager.isOnline

    /** Con la jornada cerrada el GPS está apagado (ver [syncJourney]). */
    private var updatesOn = false

    private fun journeyOpen(): Boolean =
        preferences.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)

    /**
     * Estado de la red al momento de usarlo. El valor guardado dependía de un
     * aviso del sistema que a veces no llega y dejaba la cola sin subir, con
     * la red disponible, hasta reiniciar la app.
     */
    private fun online(): Boolean {
        isOnline = networkManager.isOnline
        return isOnline
    }

    fun start() {
        // Al arrancar, la captura queda abierta aunque un cierre anterior la
        // haya dejado congelada.
        captureFrozen = false
        // boot_id: uno nuevo cada vez que arranca la app (los puntos viejos
        // conservan el suyo).
        runCatching { databaseHelper.rotateBootId() }
        // Jornada: se lee lo guardado y se ajusta el estado.
        runCatching { journeyManager.syncFromPrefs() }
        restoreMovementState()
        journeyManager.reconcileAtStartup()
        // Rescate de Doze: la alarma se rearma en cada arranque del servicio.
        runCatching { DozeAlarmReceiver.schedule(context) }
        uploadQueue = UploadQueue(context, databaseHelper, this)
        uploadQueue?.kick(online())
        // Sin jornada no se pide ubicación: la app queda en espera.
        if (journeyOpen()) {
            try {
                positionProvider.startUpdates()
                updatesOn = true
            } catch (e: SecurityException) {
                Log.w(TAG, e)
            }
        }
        MotionMonitor.register(context)
        MotionMonitor.setTurnListener(this)
        MotionMonitor.setSignificantMotionListener { onSignificantMotion() }
        watchdog.start(System.currentTimeMillis())
        handler.postDelayed(watchdogTick, WATCHDOG_PERIOD_MS)
        handler.postDelayed(motionTick, MOTION_CHECK_PERIOD_MS)
        networkManager.start()
    }

    /**
     * Reconstrucción desde el almacén tras recreación: los últimos fixes dicen
     * en qué estado arrancar (nunca "en memoria = válido"). Si el boot dejó
     * marca de recuperación pendiente, se entra en RECOVERING.
     */
    private fun restoreMovementState() {
        // Si esto falla (base o preferencias dañadas) la app igual arranca, en
        // modo seguro: espera el primer punto y captura seguido.
        runCatching { restoreMovementStateOrThrow() }
            .onFailure {
                Log.e(TAG, "restauración fallida, modo seguro", it)
                runCatching { machine.onJourneyStarted(System.currentTimeMillis()) }
            }
    }

    private fun restoreMovementStateOrThrow() {
        val now = System.currentTimeMillis()
        val journeyOpen = journeyManager.local()?.open == true ||
            preferences.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
        val history = runCatching {
            databaseHelper.selectRecentPositions(RESTORE_HISTORY)
        }.getOrDefault(emptyList())
        // Siembra del antiduplicado con el último almacenado (el primero de
        // la lista: viene en ORDER BY id DESC): cero queries extra en régimen.
        lastStoredFix = history.firstOrNull()?.let {
            DuplicateFixGuard.Fix(it.time.time, it.latitude, it.longitude)
        }
        // Misma siembra para los filtros de captura (distancia, latido, rumbo
        // y referencia fresca del teleport): el primer fix siempre se guarda.
        history.firstOrNull()?.let {
            captureGate.seed(it.time.time, it.latitude, it.longitude, it.course, it.accuracy)
        }
        val samples = history.map {
            MovementStateMachine.FixSample(it.time.time, it.speed, 0.0)
        }
        // El desplazamiento se calcula en vivo; lo guardado aporta velocidad y
        // antigüedad, para no suponer que está quieta.
        machine.restore(now, journeyOpen, samples)
        if (journeyOpen && runCatching {
                databaseHelper.getMeta(DatabaseHelper.KEY_RECOVERY_PENDING)
            }.getOrNull() == "1"
        ) {
            runCatching { databaseHelper.putMeta(DatabaseHelper.KEY_RECOVERY_PENDING, "0") }
            machine.onRecoveryTriggered(now)
            Log.i(TAG, "recuperación pendiente del boot: RECOVERING")
        }
        applyCadence()
        persistMovementState()
    }

    /**
     * Pulso del sensor (cada 10 s): es una pista más para la máquina. La
     * frecuencia de ubicación solo cambia cuando la máquina cambia de estado,
     * para no pedir y soltar el GPS a cada rato.
     */
    private val motionTick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            // A medianoche la jornada abierta se parte aunque no entre ningún
            // punto (sin señal o con el teléfono quieto adentro).
            DmujeresApi.renovarSiCambioDeDia(context, now)
            syncJourney()
            machine.onImuHint(now, MotionMonitor.isMoving())
            machine.onTick(now)
            applyCadence(requestFixOnFine = false)
            persistMovementState()
            handler.postDelayed(this, MOTION_CHECK_PERIOD_MS)
        }
    }

    /**
     * Cada minuto: revisa el GPS (lo vuelve a pedir y, si sigue sin responder,
     * pasa al GPS del sistema) y avanza el reloj de la máquina (4 min sin
     * punto: RECOVERING). Nunca inventa posiciones.
     */
    private val watchdogTick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            // Cada minuto la cola se reactiva sola: si un aviso de red se
            // perdió o un envío quedó colgado, no espera al próximo punto.
            uploadQueue?.kick(online())
            if (!journeyOpen()) {
                handler.postDelayed(this, WATCHDOG_PERIOD_MS)
                return
            }
            machine.onTick(now)
            applyCadence(requestFixOnFine = false)
            persistMovementState()
            when (watchdog.tick(now)) {
                LocationWatchdog.Action.RE_REQUEST -> {
                    Log.w(TAG, "GPS sin fix: re-solicitando actualizaciones")
                    runCatching {
                        positionProvider.stopUpdates()
                        positionProvider.startUpdates()
                    }
                }
                LocationWatchdog.Action.FALLBACK -> switchToPlatformProvider()
                LocationWatchdog.Action.NONE -> Unit
            }
            handler.postDelayed(this, WATCHDOG_PERIOD_MS)
        }
    }

    /**
     * La jornada se abre o cierra fuera del servicio (botón de inicio, login,
     * servidor, cierre de sesión). Aquí la máquina se alinea con lo guardado
     * (ver [MovementStateMachine.syncJourney]). Al abrir se pide una ubicación
     * enseguida y se captura seguido desde ese momento.
     */
    fun syncJourney() {
        runCatching {
            val open = journeyOpen()
            val before = machine.state
            if (machine.syncJourney(System.currentTimeMillis(), open)) {
                Log.i(TAG, "jornada ${if (open) "abierta" else "cerrada"}: $before -> ${machine.state}")
                runCatching { journeyManager.syncFromPrefs() }
                applyCadence(requestFixOnFine = open)
                updateStationaryFence()
                persistMovementState()
            }
            applyJourneyPower(open)
        }.onFailure { Log.w(TAG, "no se pudo alinear la jornada", it) }
    }

    /**
     * Con la jornada cerrada la app queda en espera: sin GPS, sin cerca de
     * quietud, sin vigilante ni alarma de rescate. Al abrirla todo vuelve.
     * Lo capturado antes de cerrar se termina de subir.
     */
    private fun applyJourneyPower(open: Boolean) {
        if (open == updatesOn) return
        updatesOn = open
        if (open) {
            runCatching { positionProvider.startUpdates() }
                .onFailure { Log.w(TAG, "no se pudo encender la ubicación", it) }
            watchdog.start(System.currentTimeMillis())
            runCatching { DozeAlarmReceiver.schedule(context) }
        } else {
            runCatching { positionProvider.stopUpdates() }
            if (fenceArmed) {
                runCatching { stationaryFence.disarm() }
                fenceArmed = false
            }
            runCatching { DozeAlarmReceiver.cancel(context) }
            handler.removeCallbacks(turnReinforce)
            uploadQueue?.kick(online())
        }
        runCatching { TrackingService.showJourneyState(context, open) }
    }

    /**
     * Aplica la máquina al proveedor (solo al cambiar). Con jornada el GPS es
     * continuo siempre; movimiento/quietud solo cambian el latido de reporte.
     */
    private fun applyCadence(requestFixOnFine: Boolean = true) {
        val fine = machine.wantsFineCadence()
        val continuous = machine.state != MovementStateMachine.State.STOPPED
        if (fine == fineCadence && continuous == gpsContinuous) return
        val routeStart = fine && !fineCadence
        fineCadence = fine
        gpsContinuous = continuous
        positionProvider.applyMotionState(fine, continuous)
        Log.i(TAG, "cadencia: fina=$fine gpsContinuo=$continuous (${machine.state})")
        updateStationaryFence()
        if (routeStart && requestFixOnFine) {
            // Arranque de ruta: un fix inmediato en vez de esperar la ventana.
            runCatching { positionProvider.requestSingleLocation() }
        }
    }

    /**
     * Quietud: la cerca vigila la salida por nosotros (centro = último fix);
     * en cadencia fina sobra. Si se entró en quietud sin fix (restauración),
     * se arma con el primer fix que llegue.
     */
    private fun updateStationaryFence() {
        if (!journeyOpen()) return
        if (!fineCadence && !fenceArmed && lastFixAtMs > 0) {
            stationaryFence.arm(lastFixLat, lastFixLon)
            fenceArmed = true
        } else if (fineCadence && fenceArmed) {
            stationaryFence.disarm()
            fenceArmed = false
        }
    }

    /** El estado vigente queda en prefs para el latido (sin RAM de por medio). */
    private fun persistMovementState() {
        runCatching {
            preferences.edit()
                .putString(Prefs.MOVEMENT_STATE, machine.state.name)
                .putBoolean(Prefs.MOVEMENT_WALKING, machine.isWalking)
                .putString(
                    Prefs.MOVEMENT_MODE,
                    if (machine.isWalking) Prefs.MODE_WALK else Prefs.MODE_NORMAL,
                )
                .apply()
        }
    }

    /** Cambia al GPS del sistema cuando el de Google no responde. */
    private fun switchToPlatformProvider() {
        if (platformFallback) return
        platformFallback = true
        Log.w(TAG, "GPS del sistema como respaldo (fused sin fixes)")
        StatusActivity.addMessage(context.getString(R.string.status_platform_gps))
        machine.onPositionUnavailable()
        persistMovementState()
        runCatching {
            positionProvider.stopUpdates()
            positionProvider = AndroidPositionProvider(context, this)
            positionProvider.applyMotionState(fineCadence, gpsContinuous)
            positionProvider.startUpdates()
        }.onFailure { Log.w(TAG, "no se pudo activar el GPS del sistema", it) }
    }

    /**
     * Botón ACTUALIZAR: reanuda la cola (por si estaba en pausa por un 401 que
     * ya se resolvió), envía lo pendiente y pide una ubicación. No reinicia
     * nada.
     */
    fun refreshNow() {
        runCatching {
            uploadQueue?.resume()
            uploadQueue?.kick(online())
            if (journeyOpen()) positionProvider.requestSingleLocation()
        }.onFailure { Log.w(TAG, "refresco manual falló", it) }
    }

    /**
     * Sube lo que quede en la cola sin pedir ubicación. Se usa al finalizar la
     * jornada: lo capturado en los últimos minutos tiene que llegar aunque ya
     * no entren puntos nuevos que activen la cola.
     */
    fun drainQueue() {
        runCatching {
            uploadQueue?.resume()
            uploadQueue?.kick(online())
        }.onFailure { Log.w(TAG, "no se pudo vaciar la cola", it) }
    }

    /**
     * Despertar de recuperación (alarma/FCM): la máquina entra en RECOVERING,
     * se pide fix FRESCO (nunca last-known) y se vacía la cola. El fix que
     * llegue y la cola fluyendo cierran la recuperación.
     */
    fun onRecoveryWakeup(): Boolean {
        // Sin jornada no hay nada que rescatar: solo se vacía la cola.
        if (!journeyOpen()) {
            uploadQueue?.kick(online())
            return false
        }
        machine.onRecoveryTriggered(System.currentTimeMillis())
        persistMovementState()
        runCatching { positionProvider.requestFreshLocation() }
            .onFailure { Log.w(TAG, "fix fresco de recuperación falló", it) }
        uploadQueue?.kick(online())
        return true
    }

    fun stop() {
        // El apagado nunca debe lanzar: si el arranque quedó a medias (o stop
        // se llama dos veces), un crash aquí convierte cualquier fallo en un
        // bucle de reinicios. Cada pieza se defiende sola y esto es el seguro.
        runCatching { networkManager.stop() }.onFailure { Log.w(TAG, "al detener red", it) }
        runCatching { positionProvider.stopUpdates() }.onFailure { Log.w(TAG, "al detener proveedor", it) }
        runCatching { stationaryFence.disarm() }
        MotionMonitor.setTurnListener(null)
        MotionMonitor.setSignificantMotionListener(null)
        runCatching { MotionMonitor.unregister(context) }.onFailure { Log.w(TAG, "al liberar sensores", it) }
        runCatching { handler.removeCallbacksAndMessages(null) }.onFailure { Log.w(TAG, "al limpiar handler", it) }
    }

    override fun onPositionUpdate(position: Position) {
        // Durante el cierre de sesión (solo depuración) no entran puntos
        // nuevos a la cola mientras se vacía.
        if (captureFrozen) return
        val now = System.currentTimeMillis()
        DmujeresApi.renovarSiCambioDeDia(context, now)
        // Sin jornada abierta no se registra nada: ni recorrido ni presencia.
        if (!preferences.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)) return
        // Un salto imposible se descarta antes de que afecte a la máquina, al
        // último punto o al vigilante.
        if (captureGate.isTeleport(
                position.latitude, position.longitude,
                position.time.time, position.accuracy, position.speed,
            )
        ) {
            Log.w(TAG, "fix teleport descartado " +
                "(lat=${position.latitude} lon=${position.longitude} v=${position.speed} kn)")
            return
        }
        // Última batería vista: si el teléfono muere sin avisar, al encender
        // se sabe que fue por batería.
        runCatching { PowerEvents.noteBattery(context, position.battery.toInt()) }
        // La velocidad reportada (nudos) alimenta el detector de giros.
        MotionMonitor.lastSpeedKnots = position.speed
        // Desplazamiento desde el último fix aceptado (el GPS manda sobre el
        // IMU: suple una velocidad nula cuando el equipo sí se movió).
        val legM = if (lastFixAtMs > 0) {
            legMeters(lastFixLat, lastFixLon, position.latitude, position.longitude)
        } else {
            0.0
        }
        lastFixLat = position.latitude
        lastFixLon = position.longitude
        lastFixAtMs = now
        // El último fix con GPS falso (mock) queda para el diagnostico.
        runCatching {
            preferences.edit().putBoolean(Prefs.LAST_MOCK, position.mock).apply()
        }
        // La máquina decide (GPS > caminata > distancia > significant > IMU);
        // el forzado por velocidad anterior (holdMovingUntilMs) se elimina: era
        // una segunda autoridad de cadencia fuera de la máquina. Se alimenta
        // con coordenadas para que el avance sostenido a pie cuente como
        // movimiento aunque la instantánea sea <3 kn.
        val significant = significantMotionPending
        significantMotionPending = false
        val before = machine.state
        machine.onFixWithPosition(
            now, position.speed, legM,
            position.latitude, position.longitude,
            MotionMonitor.isMoving(), significant,
        )
        if (machine.state != before) {
            Log.i(TAG, "movimiento: $before -> ${machine.state} " +
                "(v=${position.speed} kn, d=${legM.toInt()} m, caminando=${machine.isWalking})")
        }
        applyCadence()
        updateStationaryFence()
        persistMovementState()
        watchdog.noteFix(now)
        // Filtros: estando quieta se descarta el temblor del GPS; en una
        // esquina se guarda el punto aunque no toque.
        val outcome = captureGate.evaluate(
            position.latitude, position.longitude, position.course, position.accuracy,
            position.speed, position.time.time,
            machine.state == MovementStateMachine.State.STATIONARY, now,
        )
        if (!outcome.store) {
            Log.i(TAG, "fix colapsado en parado, no se almacena (${outcome.reason})")
            return
        }
        if (outcome.reason == CaptureGate.Reason.STORE_TURN) {
            Log.i(TAG, "giro: esquina almacenada")
        }
        // Consola: una línea por minuto como máximo (el GPS entrega 1 fix/s).
        if (now - lastConsoleFixAt >= CONSOLE_FIX_GAP_MS) {
            lastConsoleFixAt = now
            val kmh = (position.speed * 1.852).toInt()
            StatusActivity.addMessage(
                context.getString(R.string.console_fix_fmt, position.accuracy.toInt(), kmh),
            )
        }
        if (buffer) {
            // El evento lleva proveedor y estado para el lote e idempotencia.
            write(position.copy(provider = positionProvider.providerName, movementState = machine.state.name))
        } else {
            send(position)
        }
    }

    private var lastConsoleFixAt = 0L
    private var lowBatteryNoticed = false

    /** Última subida hecha por un punto nuevo (para ahorrar con batería baja). */
    @Volatile
    private var lastWriteKickMs = 0L

    /** Distancia (m) entre dos coordenadas, para la velocidad implícita. */
    private fun legMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val result = FloatArray(1)
        android.location.Location.distanceBetween(lat1, lon1, lat2, lon2, result)
        return result[0].toDouble()
    }

    /**
     * Arranque de movimiento por el sensor de bajo consumo (significant motion):
     * entra a la máquina como evidencia y pide un fix ya, sin esperar al
     * acelerómetro.
     */
    fun onSignificantMotion() {
        if (!journeyOpen()) return
        Log.i(TAG, "movimiento por sensor significativo")
        significantMotionPending = true
        machine.onSignificantMotion(System.currentTimeMillis())
        applyCadence()
        persistMovementState()
        runCatching { positionProvider.requestSingleLocation() }
    }

    /** Giro fuerte (giroscopio): captura la esquina sin subir la cadencia base. */
    override fun onTurn() {
        if (!journeyOpen()) return
        Log.i(TAG, "giro fuerte: fix inmediato y refuerzo a los $TURN_REINFORCE_DELAY_MS ms")
        runCatching { positionProvider.requestSingleLocation() }
        handler.removeCallbacks(turnReinforce)
        handler.postDelayed(turnReinforce, TURN_REINFORCE_DELAY_MS)
    }

    private val turnReinforce = Runnable {
        runCatching { positionProvider.requestSingleLocation() }
    }

    override fun onPositionError(error: Throwable) {}
    override fun onNetworkUpdate(isOnline: Boolean) {
        val message = if (isOnline) R.string.status_network_online else R.string.status_network_offline
        StatusActivity.addMessage(context.getString(message))
        if (!this.isOnline && isOnline) {
            uploadQueue?.kick(true)
        }
        this.isOnline = isOnline
    }

    // --- UploadQueue.Listener --------------------------------------------------
    //
    // UploadQueue sube en orden (guardar, lote, confirmación, borrar); aquí
    // solo se reacciona a sus avisos.

    /** La cola confirmó eventos: si estábamos en rescate, se cierra. */
    override fun onQueueFlowing(confirmed: Int) {
        ConnectionState.noteSuccess(System.currentTimeMillis())
        if (confirmed > 0) StatusActivity.addMessage(context.getString(R.string.console_sent_fmt, confirmed))
        // Hay red y servidor: buen momento para los avisos de jornada pendientes.
        runCatching { DmujeresApi.flushJourneyEvents(context) }
        runCatching { PowerEvents.flush(context) }
        val before = machine.state
        machine.onRecovered(System.currentTimeMillis(), queueFlowing = true)
        if (machine.state != before) {
            Log.i(TAG, "recuperación cerrada por cola fluyendo ($confirmed confirmados)")
            applyCadence()
        }
        persistMovementState()
    }

    override fun onEventsDead(count: Int) {
        ConnectionState.noteFailure(System.currentTimeMillis())
        StatusActivity.addMessage(context.getString(R.string.status_send_fail))
        Log.w(TAG, "$count eventos DEAD (no reintentados, ya reportados)")
    }

    override fun onAuthPaused() {
        StatusActivity.addMessage(context.getString(R.string.status_send_fail))
    }

    private fun log(action: String, position: Position?) {
        var formattedAction: String = action
        if (position != null) {
            formattedAction +=
                    " (id:" + position.id +
                    " time:" + position.time.time / 1000 +
                    " lat:" + position.latitude +
                    " lon:" + position.longitude + ")"
        }
        Log.d(TAG, formattedAction)
    }

    /**
     * Primero se guarda en el teléfono y después se sube: la captura nunca
     * depende de la red.
     *
     * Google a veces entrega el mismo punto dos veces. Si es el mismo punto ya
     * guardado (misma hora y coordenadas, o mismo lugar con menos de 5 s) se
     * descarta antes de guardar. Todos los puntos aceptados pasan por aquí,
     * así que este control cubre todos los casos.
     */
    private fun write(position: Position) {
        log("write", position)
        val candidate = DuplicateFixGuard.Fix(position.time.time, position.latitude, position.longitude)
        val last = lastStoredFix ?: runCatching {
            // Solo si el arranque no la dejó lista: una sola fila y solo con
            // puntos que pasaron los filtros.
            databaseHelper.selectRecentPositions(1).firstOrNull()?.let {
                DuplicateFixGuard.Fix(it.time.time, it.latitude, it.longitude)
            }
        }.getOrNull()
        if (last != null && DuplicateFixGuard.isDuplicate(candidate, last)) {
            Log.i(TAG, "fix duplicado del fused descartado " +
                "(captured_at=${position.time.time} lat=${position.latitude} lon=${position.longitude})")
            return
        }
        // Se marca antes de guardar (que es asíncrono): si no, dos entregas del
        // mismo punto pasarían las dos. Si el guardado fallara se perdería un
        // punto suelto, que es mejor que duplicar.
        lastStoredFix = candidate
        databaseHelper.insertPositionAsync(position, object : DatabaseHandler<Unit?> {
            override fun onComplete(success: Boolean, result: Unit?) {
                val low = position.battery in 0.0..UploadThrottle.LOW_BATTERY_PCT && !position.charging
                if (low != lowBatteryNoticed) {
                    lowBatteryNoticed = low
                    if (low) StatusActivity.addMessage(context.getString(R.string.console_low_battery_mode))
                }
                if (success && UploadThrottle.shouldKick(
                        nowMs = System.currentTimeMillis(),
                        lastKickMs = lastWriteKickMs,
                        batteryPct = position.battery,
                        charging = position.charging,
                    )
                ) {
                    lastWriteKickMs = System.currentTimeMillis()
                    uploadQueue?.kick(online())
                }
            }
        })
    }

    /**
     * Modo sin cola (preferencia): envía cada punto directo, sin reintento. El
     * modo normal es con cola.
     */
    private fun send(position: Position) {
        log("send", position)
        val request = formatRequest(url, position)
        // La CPU se mantiene despierta solo durante el envío (con tope de
        // 60 s); dejarla siempre despierta gastaba mucha batería.
        if (wakeLockEnabled) SendWakeLock.acquire(context)
        runCatching {
            sendRequestAsync(request, object : RequestHandler {
                override fun onComplete(success: Boolean) {
                    if (wakeLockEnabled) SendWakeLock.release()
                    if (success) {
                        ConnectionState.noteSuccess(System.currentTimeMillis())
                    } else {
                        ConnectionState.noteFailure(System.currentTimeMillis())
                        StatusActivity.addMessage(context.getString(R.string.status_send_fail))
                    }
                }
            })
        }.onFailure {
            if (wakeLockEnabled) SendWakeLock.release()
            Log.w(TAG, "no se pudo encolar el envío", it)
        }
    }

    companion object {
        private val TAG = TrackingController::class.java.simpleName

        /**
         * Congela la captura durante el cierre de sesión (solo depuración):
         * mientras está activo, los puntos nuevos no se guardan. Lo activa
         * [SessionCloser] al empezar y se quita al terminar o al volver a
         * arrancar.
         */
        @Volatile
        var captureFrozen: Boolean = false

        /** Revisión del vigilante de GPS (re-solicitud / respaldo AOSP). */
        private const val WATCHDOG_PERIOD_MS = 60_000L

        /** Pulso del sensor de movimiento (una pista, no decide solo). */
        private const val MOTION_CHECK_PERIOD_MS = 10_000L

        /** Refuerzo del fix por giro: uno solo, 3 s después del giro. */
        private const val TURN_REINFORCE_DELAY_MS = 3_000L

        /** Fixes del historial usados para reconstruir tras recreación. */
        private const val RESTORE_HISTORY = 20
    }

}

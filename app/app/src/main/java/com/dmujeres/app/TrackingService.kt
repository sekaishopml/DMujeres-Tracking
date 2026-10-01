/*
 * Copyright 2012 - 2021 Anton Tananaev (anton@traccar.org)
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
package com.dmujeres.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import java.lang.RuntimeException

class TrackingService : Service() {

    private var trackingController: TrackingController? = null
    private var powerReceiver: android.content.BroadcastReceiver? = null

    override fun onCreate() {
        val sharedPreferences = PreferenceManager.getDefaultSharedPreferences(this)
        try {
            startForeground(NOTIFICATION_ID, createNotification(this))
            Log.i(TAG, "service create")
            isRunning = true
            // Estado del teléfono visible en el panel (lastDiagnostics).
            ServiceHeartbeat.start(this)
            sendBroadcast(Intent(ACTION_STARTED).setPackage(packageName))
            StatusActivity.addMessage(getString(R.string.status_service_create))

            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                // La CPU se mantiene despierta solo durante cada envío
                // (Prefs.WAKELOCK sigue siendo el interruptor).
                trackingController = TrackingController(this)
                controllerRef = trackingController
                trackingController?.start()
            }
            // La alarma de rescate sobrevive aunque el sistema cierre la app;
            // se vuelve a programar cada vez que arranca el servicio.
            com.dmujeres.app.recovery.DozeAlarmReceiver.schedule(this)
            // Apagado del teléfono con su causa (batería o manual) para el panel.
            powerReceiver = runCatching { PowerEvents.register(this) }.getOrNull()
            PowerEvents.flush(this)
            DmujeresApi.flushJourneyEvents(this)
        } catch (e: RuntimeException) {
            Log.w(TAG, e)
            sharedPreferences.edit().putBoolean(Prefs.STATUS, false).apply()
            // Si el servicio no arranca, la consola y el panel lo dicen y
            // explican por qué no hay ruta.
            runCatching { StatusActivity.addMessage(getString(R.string.status_service_create_fail)) }
            stopSelf()
        }
    }

    override fun onBind(intent: Intent): IBinder? {
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        WakefulBroadcastReceiver.completeWakefulIntent(intent)
        // Si el servicio arrancó sin permiso de ubicación precisa y el permiso
        // llegó después, onCreate no se repite: aquí se crea el controlador
        // para que el registro no quede apagado hasta reiniciar.
        runCatching { ensureController() }
            .onFailure { Log.w(TAG, "no se pudo asegurar el controlador", it) }
        // Cada arranque pedido (p. ej. "Iniciar jornada" con el servicio ya
        // vivo) alinea la máquina con la jornada sin esperar el pulso.
        runCatching { controllerRef?.syncJourney() }
        // Rescate pedido por push: si el ahorro de energía congeló el servicio,
        // no alcanza con relanzarlo; se pide una ubicación nueva y captura
        // seguida (RECOVERING).
        if (intent?.action == ACTION_RECOVER) {
            runCatching { controllerRef?.onRecoveryWakeup() }
        }
        return START_STICKY
    }

    /**
     * Crea el controlador si falta y ya hay permiso (caso: servicio nacido sin
     * permiso, concedido después desde Ajustes con el servicio vivo).
     */
    private fun ensureController() {
        if (!shouldEnsureController(
                hasPermission = ContextCompat.checkSelfPermission(
                    this, Manifest.permission.ACCESS_FINE_LOCATION,
                ) == PackageManager.PERMISSION_GRANTED,
                hasController = controllerRef != null,
            )
        ) {
            return
        }
        trackingController = TrackingController(this)
        controllerRef = trackingController
        runCatching { trackingController?.start() }
            .onFailure { Log.w(TAG, "no se pudo arrancar el controlador", it) }
    }

    override fun onDestroy() {
        isRunning = false
        powerReceiver?.let { runCatching { unregisterReceiver(it) } }
        powerReceiver = null
        controllerRef = null
        ServiceHeartbeat.stop()
        // Sin servicio no hay rescate: se cancela la alarma (el próximo
        // arranque la vuelve a programar). Si el sistema cierra la app sin
        // onDestroy, la alarma sigue y el receptor la reprograma.
        runCatching { com.dmujeres.app.recovery.DozeAlarmReceiver.cancel(this) }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        Log.i(TAG, "service destroy")
        sendBroadcast(Intent(ACTION_STOPPED).setPackage(packageName))
        StatusActivity.addMessage(getString(R.string.status_service_destroy))
        // El apagado nunca lanza: si el arranque quedó a medias, un crash aquí
        // convierte cualquier fallo en un bucle de reinicios del sistema.
        runCatching { trackingController?.stop() }
            .onFailure { Log.w(TAG, "al detener controlador", it) }
    }

    companion object {

        /** Estado del FGS visible para la pantalla principal (home). */
        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        private var controllerRef: TrackingController? = null

        /** Refresco manual desde el home: true si el servicio está activo. */
        fun refreshNow(): Boolean {
            val controller = controllerRef ?: return false
            controller.refreshNow()
            return true
        }

        /**
         * Rescate (alarma o push): si el servicio vive, ubicación nueva y envío
         * de la cola. Si la app está cerrada no se arranca el servicio a
         * escondidas (Android 12 o más lo rechaza): se reprograma la alarma y
         * se cuenta el intento; el arranque lo hace la persona.
         */
        fun onDozeAlarm(context: Context): Boolean {
            val controller = controllerRef
            if (controller != null) {
                return runCatching { controller.onRecoveryWakeup() }.getOrDefault(false)
            }
            Log.i(TAG, "alarma sin servicio activo: solo rearme (sin arranque silencioso)")
            return false
        }

        /**
         * Salida de la cerca de quietud (Play Services): movimiento real
         * aunque el acelerómetro esté dormido. Solo actúa con el servicio vivo.
         */
        fun onStationaryExit(): Boolean {
            val controller = controllerRef ?: return false
            return runCatching { controller.onSignificantMotion(); true }.getOrDefault(false)
        }

        // Explicit package name should be specified when broadcasting START/STOP notifications -
        // it is required for manifest-declared receiver of the status widget (when running on Android 8+).
        // Refer to https://developer.android.com/guide/components/broadcasts#manifest-declared-receivers -
        // it is required for manifest-declared receiver of the status widget (when running on Android 8+).
        // Refer to https://developer.android.com/guide/components/broadcasts#manifest-declared-receivers
        const val ACTION_STARTED = "com.dmujeres.app.action.SERVICE_STARTED"
        const val ACTION_RECOVER = "com.dmujeres.app.action.RECOVER"
        const val ACTION_STOPPED = "com.dmujeres.app.action.SERVICE_STOPPED"
        private val TAG = TrackingService::class.java.simpleName

        /**
         * Para [ensureController]: solo se crea si hay permiso y falta el
         * controlador. Nunca se destruye ni se duplica.
         */
        fun shouldEnsureController(hasPermission: Boolean, hasController: Boolean): Boolean =
            hasPermission && !hasController
        private const val NOTIFICATION_ID = 1

        @SuppressLint("UnspecifiedImmutableFlag")
        private fun createNotification(context: Context): Notification {
            val builder = NotificationCompat.Builder(context, MainApplication.PRIMARY_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
            val intent = Intent(context, MainActivity::class.java)
            builder
                .setContentTitle(context.getString(R.string.settings_status_on_summary))
                .setTicker(context.getString(R.string.settings_status_on_summary))
                .color = ContextCompat.getColor(context, R.color.primary_dark)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            builder.setContentIntent(PendingIntent.getActivity(context, 0, intent, flags))
            return builder.build()
        }
    }
}

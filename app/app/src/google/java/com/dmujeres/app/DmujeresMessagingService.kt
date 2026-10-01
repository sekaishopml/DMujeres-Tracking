package com.dmujeres.app

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Avisos push (FCM).
 *
 * El servidor manda un mensaje `type=TRACKING_RECOVERY_PROBE` con
 * `recoveryAttemptId` cuando un teléfono deja de reportar. Al recibirlo se
 * enciende la captura y se le confirma al servidor, que lo deja registrado.
 */
class DmujeresMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        DmujeresApi.registerFcmToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val type = message.data["type"] ?: return
        if (type != "TRACKING_RECOVERY_PROBE") {
            Log.i(TAG, "Push ignorado: $type")
            return
        }
        val attemptId = message.data["recoveryAttemptId"].orEmpty()
        // Etapas que acepta el servidor: RECOVERY_RECEIVED y RECOVERY_STARTED
        // (otra cosa se rechaza como UNKNOWN_STAGE).
        DmujeresApi.recoveryAck(this, attemptId, "RECOVERY_RECEIVED")
        // La recuperación enciende la captura aunque se hubiera apagado: es una
        // orden de la operación y queda registrada.
        PreferenceManager.getDefaultSharedPreferences(this)
            .edit().putBoolean(Prefs.STATUS, true).apply()
        ContextCompat.startForegroundService(
            this,
            Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_RECOVER),
        )
        DmujeresApi.recoveryAck(this, attemptId, "RECOVERY_STARTED")
        Log.i(TAG, "Recuperación FCM atendida (attempt=$attemptId)")
    }

    private companion object {
        const val TAG = "DmujeresFcm"
    }
}

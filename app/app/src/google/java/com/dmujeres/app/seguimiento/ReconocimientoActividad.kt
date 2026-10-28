package com.dmujeres.app.seguimiento

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.dmujeres.app.sistema.AjustesPermisos
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Reconocimiento de actividad de Play Services: avisa cada ~30 s si el
 * teléfono va a pie, en vehículo o quieto. Es una señal más, no un requisito:
 * sin permiso de actividad física o sin Play Services simplemente no llega.
 */
object ReconocimientoActividad {
    private const val TAG = "ReconocimientoActividad"
    private const val INTERVALO_MS = 30_000L

    private fun pedido(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, ReconocimientoActividadReceiver::class.java).setPackage(context.packageName),
            // Play Services escribe el resultado en el intent: tiene que ser mutable.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )

    fun iniciar(context: Context) {
        if (!AjustesPermisos.actividadFisica(context)) return
        runCatching {
            ActivityRecognition.getClient(context.applicationContext)
                .requestActivityUpdates(INTERVALO_MS, pedido(context))
                .addOnFailureListener { Log.w(TAG, "no se pudo pedir la actividad: ${it.message}") }
        }.onFailure { Log.w(TAG, "reconocimiento no disponible: ${it.message}") }
    }

    fun detener(context: Context) {
        runCatching { ActivityRecognition.getClient(context.applicationContext).removeActivityUpdates(pedido(context)) }
    }

    fun nombre(tipo: Int): String = when (tipo) {
        DetectedActivity.WALKING -> "WALKING"
        DetectedActivity.ON_FOOT -> "ON_FOOT"
        DetectedActivity.RUNNING -> "RUNNING"
        DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
        DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
        DetectedActivity.STILL -> "STILL"
        else -> "UNKNOWN"
    }
}

class ReconocimientoActividadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!ActivityRecognitionResult.hasResult(intent)) return
        val resultado = ActivityRecognitionResult.extractResult(intent) ?: return
        val probable = resultado.mostProbableActivity
        // Una lectura dudosa (menos de 50 %) no se guarda: mejor vacío que mal.
        if (probable.confidence < 50) return
        ActividadFisica.registrar(context, ReconocimientoActividad.nombre(probable.type))
        if (probable.confidence >= CONFIANZA_ARRANQUE && probable.type in EN_MOVIMIENTO) MotionMonitor.avisarMovimiento()
    }

    private companion object {
        const val CONFIANZA_ARRANQUE = 70
        val EN_MOVIMIENTO = setOf(
            DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE, DetectedActivity.ON_FOOT,
            DetectedActivity.WALKING, DetectedActivity.RUNNING,
        )
    }
}

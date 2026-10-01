package com.dmujeres.app

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

object StationaryFenceFactory {

    fun create(context: Context): StationaryFence = GeofenceStationaryFence(context.applicationContext)
}

/**
 * Geocerca de salida alrededor del punto de quietud (ver [StationaryFence]).
 * Sin disparo inicial: si el fix del armado ya cae fuera por ruido, no se
 * despierta en bucle; solo cuenta la salida real posterior.
 */
class GeofenceStationaryFence(private val context: Context) : StationaryFence {

    private val client = LocationServices.getGeofencingClient(context)

    @SuppressLint("MissingPermission")
    override fun arm(latitude: Double, longitude: Double) {
        runCatching {
            val fence = Geofence.Builder()
                .setRequestId(REQUEST_ID)
                .setCircularRegion(latitude, longitude, StationaryFence.RADIUS_M)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
                .build()
            val request = GeofencingRequest.Builder()
                .setInitialTrigger(0)
                .addGeofence(fence)
                .build()
            client.addGeofences(request, pendingIntent(context))
                .addOnSuccessListener { Log.i(TAG, "cerca de quietud armada") }
                .addOnFailureListener { Log.w(TAG, "cerca de quietud no disponible", it) }
        }.onFailure { Log.w(TAG, "no se pudo armar la cerca", it) }
    }

    override fun disarm() {
        runCatching { client.removeGeofences(listOf(REQUEST_ID)) }
    }

    companion object {
        private const val TAG = "StationaryFence"
        private const val REQUEST_ID = "dmj-quietud"

        // Play Services completa el intent con el evento: debe ser MUTABLE.
        private fun pendingIntent(context: Context): PendingIntent {
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val intent = Intent(context, StationaryExitReceiver::class.java)
            return PendingIntent.getBroadcast(context, 0, intent, flags)
        }
    }
}

/** Salida de la cerca: el equipo se movió; se pasa a cadencia fina ya. */
class StationaryExitReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = runCatching { GeofencingEvent.fromIntent(intent) }.getOrNull() ?: return
        if (event.hasError()) return
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_EXIT) return
        Log.i("StationaryFence", "salida de la cerca de quietud: movimiento")
        TrackingService.onStationaryExit()
    }
}

package com.dmujeres.app.seguimiento

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Rescate en paralelo: mientras el proveedor vigente no entrega posiciones,
 * se pide UNA ubicación nueva a la red (WiFi y antenas), que responde bajo
 * techo. Nunca la última conocida: un punto viejo taparía el hueco con un
 * lugar falso.
 */
object RescateRed {

    private const val TAG = "RescateRed"

    @SuppressLint("MissingPermission")
    fun pedir(context: Context, alRecibir: (Location) -> Unit) {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        val activa = runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)
        if (!activa) return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                manager.getCurrentLocation(
                    LocationManager.NETWORK_PROVIDER,
                    CancellationSignal(),
                    ContextCompat.getMainExecutor(context),
                ) { location -> if (location != null) alRecibir(location) }
            } else {
                @Suppress("DEPRECATION")
                manager.requestSingleUpdate(
                    LocationManager.NETWORK_PROVIDER,
                    object : LocationListener {
                        override fun onLocationChanged(location: Location) = alRecibir(location)
                        @Deprecated("Deprecated in Java")
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                    },
                    Looper.getMainLooper(),
                )
            }
        }.onFailure { Log.w(TAG, "no se pudo pedir ubicación por red", it) }
    }
}

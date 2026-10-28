package com.dmujeres.app.seguimiento

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.Log
import com.dmujeres.app.captura.GpsEstable

/**
 * GPS del teléfono encendido en paralelo mientras la persona se mueve con
 * Google como proveedor. Lo mantiene caliente para que, si Google calla o se
 * degrada, el cambio al GPS sea inmediato y sin el arranque en frío que dibuja
 * saltos falsos; mientras Google calla, sus posiciones llenan el hueco.
 */
class GpsTibio(context: Context, private val alRecibir: (Location) -> Unit) : LocationListener {

    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    val estable = GpsEstable()
    var encendido = false
        private set

    @SuppressLint("MissingPermission")
    fun encender() {
        val gps = manager ?: return
        if (encendido) return
        runCatching {
            gps.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, this, Looper.getMainLooper())
            encendido = true
            estable.reiniciar()
        }.onFailure { Log.w(TAG, "no se pudo encender el GPS en paralelo", it) }
    }

    fun apagar() {
        if (!encendido) return
        runCatching { manager?.removeUpdates(this) }
        encendido = false
        estable.reiniciar()
    }

    override fun onLocationChanged(location: Location) {
        estable.anotar(
            System.currentTimeMillis(), location.latitude, location.longitude,
            if (location.hasAccuracy()) location.accuracy.toDouble() else -1.0,
            if (location.hasSpeed()) location.speed.toDouble() else 0.0,
        )
        alRecibir(location)
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    companion object {
        private const val TAG = "GpsTibio"
    }
}

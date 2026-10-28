/*
 * Copyright 2019 - 2021 Anton Tananaev (anton@traccar.org)
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

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper

class AndroidPositionProvider(
    context: Context,
    listener: PositionListener,
    /** Proveedor con jornada: GPS del teléfono o red (escalón de respaldo). */
    private val fuente: String = LocationManager.GPS_PROVIDER,
) : PositionProvider(context, listener), LocationListener {

    override val providerName: String =
        if (fuente == LocationManager.NETWORK_PROVIDER) "network" else "gps"


    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    @Volatile
    private var started = false

    /** Estado asumido al arrancar: movimiento y GPS continuo. */
    @Volatile
    private var moving = true

    @Volatile
    private var gpsContinuous = true

    /** Proveedor vigente: GPS con jornada, red sin jornada. */
    @Volatile
    private var provider = LocationManager.GPS_PROVIDER

    override fun startUpdates() {
        started = true
        updateReportInterval(moving)
        requestUpdates()
    }

    override fun stopUpdates() {
        started = false
        locationManager.removeUpdates(this)
    }

    override fun applyMotionState(moving: Boolean, gpsContinuous: Boolean) {
        val cambiaPedido = this.gpsContinuous != gpsContinuous || (gpsContinuous && this.moving != moving)
        this.moving = moving
        updateReportInterval(moving)
        if (!cambiaPedido) return
        this.gpsContinuous = gpsContinuous
        if (started) {
            locationManager.removeUpdates(this)
            requestUpdates()
        }
    }

    @SuppressLint("MissingPermission")
    private fun requestUpdates() {
        val cadence = AdaptiveCadence.request(gpsContinuous, quieta = !moving)
        provider = if (gpsContinuous) fuente else LocationManager.NETWORK_PROVIDER
        try {
            locationManager.requestLocationUpdates(provider, cadence.intervalMs, cadence.minDistanceM, this)
        } catch (e: RuntimeException) {
            listener.onPositionError(e)
        }
    }

    @Suppress("DEPRECATION", "MissingPermission")
    override fun requestSingleLocation() {
        try {
            val location = locationManager.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
            if (location != null) {
                listener.onPositionUpdate(Position(deviceId, location, getBatteryStatus(context)))
            } else {
                requestFreshLocation()
            }
        } catch (e: RuntimeException) {
            listener.onPositionError(e)
        }
    }

    /**
     * Recuperación: `requestSingleUpdate` directa al proveedor vigente, sin
     * pasar por last-known (ver [PositionProvider.requestFreshLocation]).
     */
    @Suppress("DEPRECATION", "MissingPermission")
    override fun requestFreshLocation() {
        try {
            locationManager.requestSingleUpdate(provider, object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    listener.onPositionUpdate(Position(deviceId, location, getBatteryStatus(context)))
                }

                override fun onStatusChanged(provider: String, status: Int, extras: Bundle) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            }, Looper.myLooper())
        } catch (e: RuntimeException) {
            listener.onPositionError(e)
        }
    }

    override fun onLocationChanged(location: Location) {
        processLocation(location)
    }

    override fun onStatusChanged(provider: String, status: Int, extras: Bundle) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

}

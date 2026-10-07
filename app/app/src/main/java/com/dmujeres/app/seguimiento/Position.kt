/*
 * Copyright 2015 - 2022 Anton Tananaev (anton@traccar.org)
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

import android.location.Location
import android.os.Build
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.sistema.BatteryStatus
import java.util.*

data class Position(
    val id: Long = 0,
    val deviceId: String,
    val time: Date,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val altitude: Double = 0.0,
    val speed: Double = 0.0,
    val course: Double = 0.0,
    val accuracy: Double = 0.0,
    val battery: Double = 0.0,
    val charging: Boolean = false,
    val mock: Boolean = false,
    // Identidad estable (device_id, boot_id, local_sequence): la asigna el
    // almacén al persistir; nunca se usa el timestamp como identidad.
    val bootId: String = "",
    val localSequence: Long = 0L,
    val journeyId: String = "",
    val provider: String = "",
    val movementState: String = "",
    // En la cola: PENDING se envía; lo confirmado se borra; DEAD no se reintenta.
    val status: String = STATUS_PENDING,
    val attempts: Int = 0,
    // Equipo con el que se capturó el fix (columna `device_id` de la v7): lo
    // fija el almacén al insertar con el Prefs.DEVICE vigente en ese momento.
    // Vacío en filas anteriores a la migración: se suben con el identificador
    // actual, como hasta hoy.
    val captureDeviceId: String = "",
) {

    constructor(deviceId: String, location: Location, battery: BatteryStatus) : this(
        deviceId = deviceId,
        time = Date(location.time.correctRollover()),
        latitude = location.latitude,
        longitude = location.longitude,
        altitude = location.altitude,
        speed = location.speed * 1.943844, // speed in knots
        course = location.bearing.toDouble(),
        // Precisión real de cualquier proveedor, para que el servidor distinga
        // un punto bueno de uno aproximado.
        accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0,
        battery = battery.level,
        charging = battery.charging,
        mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        } else {
            false
        },
    )
}

private const val rolloverDate = 1554508800000L // April 6, 2019
private const val rolloverOffset = 619315200000L // 1024 weeks

/** Estados de la columna `status` del almacén local. */
const val STATUS_PENDING = "PENDING"
const val STATUS_DEAD = "DEAD"

private fun Long.correctRollover(): Long {
    return if (this < rolloverDate) this + rolloverOffset else this
}

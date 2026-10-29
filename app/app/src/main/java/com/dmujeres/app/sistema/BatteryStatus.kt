/*
 * Copyright 2022 Anton Tananaev (anton@traccar.org)
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
package com.dmujeres.app.sistema

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

data class BatteryStatus(
    val level: Double = 0.0,
    val charging: Boolean = false,
    /** °C de la batería; null si el teléfono no la informa o el dato quedó viejo. */
    val temperatureC: Double? = null,
    /** false: el aviso guardado de Android no coincide con la carga real (quedó congelado). */
    val vigente: Boolean = true,
)

/** Lee el estado de batería del sticky broadcast (sin receptor propio). */
fun readBatteryStatus(context: Context): BatteryStatus {
    val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    if (batteryIntent != null) {
        val level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, 0)
        val scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, 1)
        val status = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        // El aviso guardado de Android no se renueva en algunas marcas (Xiaomi)
        // mientras la app trabaja de fondo: la carga y la temperatura quedaban
        // fijas horas. La carga en vivo dice si ese aviso sigue al día.
        val enVivo = runCatching {
            (context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager)
                .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        }.getOrDefault(-1).takeIf { it in 0..100 }
        val guardado = level * 100.0 / scale
        val vigente = enVivo == null || kotlin.math.abs(enVivo - guardado) < 2.0
        return BatteryStatus(
            level = enVivo?.toDouble() ?: guardado,
            vigente = vigente,
            charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL,
            // Viene en décimas de grado; 0 o menos es "no la informa".
            temperatureC = batteryIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
                .takeIf { it > 0 && vigente }?.let { it / 10.0 },
        )
    }
    return BatteryStatus()
}

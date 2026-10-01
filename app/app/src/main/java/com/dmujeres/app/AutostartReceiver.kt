/*
 * Copyright 2013 - 2021 Anton Tananaev (anton@traccar.org)
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

import android.content.Context
import android.content.Intent
import androidx.preference.PreferenceManager

class AutostartReceiver : WakefulBroadcastReceiver() {

    @Suppress("UnsafeProtectedBroadcastReceiver")
    override fun onReceive(context: Context, intent: Intent) {
        // La alarma de rescate se rearma en boot y en reemplazo del paquete
        // (Doze congela el Handler pero respeta setAndAllowWhileIdle).
        runCatching { com.dmujeres.app.recovery.DozeAlarmReceiver.schedule(context) }
        // Encendido del teléfono (no la reinstalación de la app).
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            runCatching { PowerEvents.onBoot(context) }
        }
        val sharedPreferences = PreferenceManager.getDefaultSharedPreferences(context)
        // Si había jornada abierta, el próximo arranque entra en RECOVERING y
        // revisa con el servidor (no supone que siguió todo bien).
        runCatching {
            val journeyOpen = sharedPreferences.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
            if (journeyOpen) {
                DatabaseHelper(context).putMeta(DatabaseHelper.KEY_RECOVERY_PENDING, "1")
            }
        }
        // En Android 12 o más, arrancar en segundo plano puede ser rechazado.
        // Si pasa, se registra y la alarma (ya reprogramada arriba) o la
        // próxima vez que se abra la app lo vuelven a intentar. Si el
        // fabricante no deja arrancar en segundo plano, hay que abrir la app.
        if (sharedPreferences.getBoolean(Prefs.STATUS, false)) {
            runCatching {
                startWakefulForegroundService(context, Intent(context, TrackingService::class.java))
            }.onFailure {
                android.util.Log.w("AutostartReceiver", "arranque en boot rechazado, reintenta la alarma/apertura", it)
                runCatching {
                    StatusActivity.addMessage("Arranque en boot rechazado por el sistema")
                }
            }
        }
    }

}

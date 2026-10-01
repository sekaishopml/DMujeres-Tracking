/*
 * Copyright 2016 - 2021 Anton Tananaev (anton@traccar.org)
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

import androidx.multidex.MultiDexApplication
import android.annotation.TargetApi
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.graphics.Color
import android.os.Build
import android.app.Activity

open class MainApplication : MultiDexApplication() {

    override fun onCreate() {
        super.onCreate()
        // Antes de que cualquier servicio abra la cola.
        DatabaseHelper.migrarNombreAnterior(this)
        System.setProperty("http.keepAliveDuration", (30 * 60 * 1000).toString())
        // Los cierres inesperados de la app se ven en el panel (lastDiagnostics.crash).
        CrashReporter.install(this)
        // Consola de estado persistente entre arranques.
        StatusActivity.attach(this)
        // Configuración inicial (equipo, servidor, 30 s / 50 m / 15°, alta
        // precisión) antes de cualquier lectura: el asistente ya muestra los
        // campos llenos y el servicio arranca bien configurado.
        androidx.preference.PreferenceManager.setDefaultValues(this, R.xml.preferences, false)
        // Si la dirección del servidor quedó vacía (por ajustes de versiones
        // viejas), se vuelve a poner la de fábrica; sin ella no se puede
        // enviar ni entrar.
        val prefs = androidx.preference.PreferenceManager.getDefaultSharedPreferences(this)
        if (prefs.getString(Prefs.URL, "").isNullOrBlank()) {
            prefs.edit().putString(Prefs.URL, getString(R.string.settings_url_default_value)).apply()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            registerChannel()
        }
        // Teléfono solo en vertical; la tablet gira (ver Responsivo).
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: android.os.Bundle?) =
                Responsivo.fijarOrientacion(activity)
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityResumed(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }

    @TargetApi(Build.VERSION_CODES.O)
    private fun registerChannel() {
        val channel = NotificationChannel(
            PRIMARY_CHANNEL, getString(R.string.channel_default), NotificationManager.IMPORTANCE_LOW
        )
        channel.lightColor = Color.GREEN
        channel.lockscreenVisibility = Notification.VISIBILITY_SECRET
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }

    open fun handleRatingFlow(activity: Activity) {}

    companion object {
        const val PRIMARY_CHANNEL = "default"
    }

}

/*
 * Copyright 2015 - 2021 Anton Tananaev (anton@traccar.org)
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
@file:Suppress("DEPRECATION")
package com.dmujeres.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.util.Log

class NetworkManager(private val context: Context, private val handler: NetworkHandler?) : BroadcastReceiver() {

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    // start() puede no haber corrido (arranque fallido) o stop() puede
    // llamarse dos veces. Sin esta marca, unregisterReceiver lanza
    // IllegalArgumentException y un fallo de arranque terminaba en cierres
    // repetidos de la app.
    @Volatile
    private var registrado = false

    interface NetworkHandler {
        fun onNetworkUpdate(isOnline: Boolean)
    }

    val isOnline: Boolean
        get() {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                val network = connectivityManager.activeNetwork ?: return false
                val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
                return capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
            val activeNetwork = connectivityManager.activeNetworkInfo
            return activeNetwork != null && activeNetwork.isConnectedOrConnecting
        }

    fun start() {
        if (registrado) return
        val filter = IntentFilter()
        filter.addAction(ConnectivityManager.CONNECTIVITY_ACTION)
        runCatching { context.registerReceiver(this, filter) }
            .onSuccess { registrado = true }
            .onFailure { Log.w(TAG, "no se pudo registrar red", it) }
    }

    fun stop() {
        if (!registrado) return
        registrado = false
        runCatching { context.unregisterReceiver(this) }
            .onFailure { Log.w(TAG, "red ya liberada", it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ConnectivityManager.CONNECTIVITY_ACTION && handler != null) {
            val isOnline = isOnline
            Log.i(TAG, "network " + if (isOnline) "on" else "off")
            handler.onNetworkUpdate(isOnline)
        }
    }

    companion object {
        private val TAG = NetworkManager::class.java.simpleName
    }

}

package com.dmujeres.app.sistema

import android.content.Context
import android.os.PowerManager
import android.util.Log

/**
 * Wake lock de corta duración para el envío de posiciones.
 *
 * Antes el servicio tomaba un PARTIAL_WAKE_LOCK permanente (834 mAh/24 h);
 * ahora la CPU solo se mantiene despierta mientras hay un POST en curso, con
 * timeout de seguridad y conteo de referencias para no soltar de más.
 */
object SendWakeLock {

    private const val TAG = "SendWakeLock"

    /** El POST tiene timeout de 15 s; 60 s cubre la demora del sistema. */
    private const val TIMEOUT_MS = 60_000L

    private val lock = Any()
    private var wakeLock: PowerManager.WakeLock? = null
    private var holders = 0

    fun acquire(context: Context) {
        synchronized(lock) {
            holders++
            if (wakeLock == null) {
                runCatching {
                    val powerManager = context.applicationContext
                        .getSystemService(Context.POWER_SERVICE) as PowerManager
                    wakeLock = powerManager
                        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dmujeres:send")
                        .apply {
                            setReferenceCounted(false)
                            acquire(TIMEOUT_MS)
                        }
                }.onFailure { Log.w(TAG, "no se pudo tomar el wake lock de envío", it) }
            }
        }
    }

    fun release() {
        synchronized(lock) {
            if (holders > 0) holders--
            if (holders == 0) {
                runCatching {
                    val lock = wakeLock
                    wakeLock = null
                    if (lock?.isHeld == true) lock.release()
                }.onFailure { Log.w(TAG, "no se pudo soltar el wake lock de envío", it) }
            }
        }
    }
}

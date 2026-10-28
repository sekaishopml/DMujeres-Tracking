package com.dmujeres.app.sistema

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * Mantiene el procesador despierto SOLO mientras faltan posiciones, en tramos
 * cortos con tope. Con la CPU dormida, algunos fabricantes dejan de entregar
 * el GPS aunque el servicio siga vivo. Al llegar un punto se suelta.
 *
 * En Huawei y Honor el ahorro de energía respeta el nombre
 * "LocationManagerService"; con otro nombre corta el bloqueo.
 */
object VigiliaGps {

    private const val TAG = "VigiliaGps"

    /** Cada toma dura como mucho esto; si sigue sin GPS se vuelve a tomar. */
    const val TRAMO_MS = 90_000L

    private val candado = Any()
    private var bloqueo: PowerManager.WakeLock? = null

    fun etiqueta(fabricante: String): String =
        if (fabricante.trim().lowercase() in setOf("huawei", "honor")) "LocationManagerService" else "dmujeres:gps"

    fun tomar(context: Context) {
        synchronized(candado) {
            runCatching {
                val actual = bloqueo ?: (context.applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, etiqueta(Build.MANUFACTURER.orEmpty()))
                    .apply { setReferenceCounted(false) }
                    .also { bloqueo = it }
                // Volver a tomarlo extiende el plazo desde ahora.
                actual.acquire(TRAMO_MS)
            }.onFailure { Log.w(TAG, "no se pudo mantener despierto", it) }
        }
    }

    fun soltar() {
        synchronized(candado) {
            runCatching { bloqueo?.takeIf { it.isHeld }?.release() }
                .onFailure { Log.w(TAG, "no se pudo soltar", it) }
        }
    }

    fun activa(): Boolean = synchronized(candado) { bloqueo?.isHeld == true }
}

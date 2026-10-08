package com.dmujeres.app.sistema

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Estado de los servicios de Google del teléfono. De ellos dependen la
 * ubicación y el aviso que despierta la app: si faltan o están desactualizados,
 * se explica por qué no llegan los avisos.
 */
object EstadoPlay {
    fun leer(context: Context): String = runCatching {
        val codigo = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
        if (codigo == ConnectionResult.SUCCESS) "ok" else "falla_$codigo"
    }.getOrDefault("desconocido")
}

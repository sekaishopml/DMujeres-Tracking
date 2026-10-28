package com.dmujeres.app.seguimiento

import android.content.Context
import androidx.preference.PreferenceManager

/**
 * Qué está haciendo la persona según el teléfono (caminando, en vehículo,
 * quieta), con los pasos de la jornada. Cada punto guardado lleva los dos
 * datos: el panel los usa para saber si el tramo sin trazar fue a pie.
 *
 * El tipo lo escribe el reconocimiento de actividad de Google (solo en la
 * variante con Play Services); sin él queda vacío y solo viajan los pasos.
 */
object ActividadFisica {
    private const val KEY_TIPO = "actividadTipo"
    private const val KEY_EN = "actividadEn"

    /** Una lectura más vieja que esto ya no describe lo que pasa ahora. */
    private const val VIGENCIA_MS = 3 * 60_000L

    fun registrar(context: Context, tipo: String, ahoraMs: Long = System.currentTimeMillis()) {
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(KEY_TIPO, tipo)
            .putLong(KEY_EN, ahoraMs)
            .apply()
    }

    /** Tipo vigente (WALKING, IN_VEHICLE, STILL...) o vacío. */
    fun tipo(context: Context, ahoraMs: Long = System.currentTimeMillis()): String {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        if (ahoraMs - prefs.getLong(KEY_EN, 0L) > VIGENCIA_MS) return ""
        return prefs.getString(KEY_TIPO, "").orEmpty()
    }

    /** Texto que se guarda con el punto: "TIPO|pasos" (vacío si no hay nada). */
    fun paraPunto(context: Context): String {
        val tipo = tipo(context)
        val pasos = if (Pasos.disponible(context)) Pasos.deLaJornada(context) else -1L
        if (tipo.isEmpty() && pasos < 0) return ""
        return "$tipo|$pasos"
    }

    /** Separa lo que guarda [paraPunto]: tipo y pasos (null si no hay). */
    fun separar(valor: String): Pair<String?, Long?> {
        if (valor.isBlank()) return null to null
        val tipo = valor.substringBefore('|').ifBlank { null }
        val pasos = valor.substringAfter('|', "").toLongOrNull()?.takeIf { it >= 0 }
        return tipo to pasos
    }
}

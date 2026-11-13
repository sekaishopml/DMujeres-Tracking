package com.dmujeres.app.datos

import android.content.Context
import androidx.preference.PreferenceManager
import org.json.JSONObject

/**
 * Ajustes finos de la captura que manda el servidor (`ajustes` en
 * /api/mobile/v1/config), para cambiar el comportamiento sin actualizar la
 * app. Cada uno tiene su valor de fábrica y un rango: ausente o fuera de rango
 * se usa el de fábrica, así un error en el servidor no deja al teléfono sin
 * ruta.
 */
object Ajustes {

    enum class Clave(val nombre: String, val defecto: Long, val min: Long, val max: Long) {
        /** Cada cuánto se pide posición en marcha. */
        GPS_MARCHA_MS("gpsMarchaMs", 1_000, 1_000, 10_000),
        /** Cada cuánto se pide posición quieta. */
        GPS_QUIETA_MS("gpsQuietaMs", 10_000, 1_000, 120_000),
        /** 1 = quieta pide ubicación de bajo consumo (wifi y antenas) en vez del GPS. */
        QUIETA_BAJO_CONSUMO("quietaBajoConsumo", 0, 0, 1),
        /** Sin posición en marcha: a este tiempo se cambia de proveedor. */
        SIN_FIX_MARCHA_MS("sinFixMarchaMs", 20_000, 5_000, 120_000),
        /** Sin posición quieta: a este tiempo se vuelve a pedir o se cambia de proveedor. */
        SIN_FIX_QUIETA_MS("sinFixQuietaMs", 120_000, 30_000, 900_000),
        /** Google sin una posición buena: a este tiempo se pasa al GPS del teléfono. */
        GOOGLE_SIN_FIX_BUENO_MS("googleSinFixBuenoMs", 20_000, 3_000, 120_000),
        /** Google calla: a este tiempo se guardan las posiciones del GPS en paralelo. */
        HUECO_GOOGLE_MS("huecoGoogleMs", 3_000, 1_000, 30_000),
        /** Alarma que revisa y revive el servicio con jornada abierta. */
        SUPERVISION_MS("supervisionMs", 180_000, 60_000, 900_000),
        /** Tandas del acelerómetro (0 = cada lectura despierta al teléfono). */
        TANDA_ACELEROMETRO_MS("tandaAcelerometroMs", 5_000, 0, 30_000),
        /** Quieta, un punto cada este tiempo aunque no se mueva. */
        LATIDO_QUIETA_MS("latidoQuietaMs", 300_000, 60_000, 900_000),
        /** Latido seguido: al llegar a un sitio y para corregir un punto malo. */
        LATIDO_CORTO_MS("latidoCortoMs", 120_000, 30_000, 300_000),
        /** Cuánto dura el latido seguido al llegar a un sitio (0 = nunca). */
        LATIDO_CORTO_INICIO_MS("latidoCortoInicioMs", 900_000, 0, 3_600_000),
        /** Sin señales de movimiento este tiempo, pasa a quieta. */
        QUIETA_TRAS_MS("quietaTrasMs", 180_000, 60_000, 900_000),
        /** Alejarse esto del sitio (dos lecturas seguidas) es salida. */
        SALIDA_M("salidaM", 80, 40, 300),
        /** Con el GPS apagado en quietud, lecturas con más error no cuentan como salida. */
        PRECISION_SALIDA_QUIETA_M("precisionSalidaQuietaM", 50, 20, 500),
        /** Pausa entre una actividad nueva y la siguiente. */
        ESPERA_ACTIVIDAD_MS("esperaActividadMs", 3_000, 0, 120_000),
        /** En horario laboral, cada cuánto se repite el aviso de ubicación apagada. */
        AVISO_UBICACION_REPETIR_MS("avisoUbicacionRepetirMs", 600_000, 120_000, 3_600_000),
        /** En horario laboral, cuántas veces se repite como mucho en el día. */
        AVISO_UBICACION_MAX("avisoUbicacionMax", 30, 2, 100),
    }

    private const val KEY = "ajustesCaptura"

    @Volatile
    private var valores: Map<String, Long> = emptyMap()

    fun valor(clave: Clave): Long = valorEn(valores, clave)

    internal fun valorEn(valores: Map<String, Long>, clave: Clave): Long =
        valores[clave.nombre]?.takeIf { it in clave.min..clave.max } ?: clave.defecto

    /** Solo números con nombre conocido; lo demás se ignora. */
    internal fun leer(json: JSONObject?): Map<String, Long> {
        if (json == null) return emptyMap()
        return Clave.values().mapNotNull { c ->
            json.opt(c.nombre).let { it as? Number }?.toLong()?.let { c.nombre to it }
        }.toMap()
    }

    /** Al arrancar la app: lo último que llegó del servidor. */
    fun cargar(context: Context) {
        val texto = PreferenceManager.getDefaultSharedPreferences(context).getString(KEY, null) ?: return
        valores = runCatching { leer(JSONObject(texto)) }.getOrDefault(emptyMap())
    }

    /** Guarda los del servidor. true si cambió algo (hay que reiniciar la captura). */
    fun aplicar(context: Context, json: JSONObject?): Boolean {
        val nuevos = leer(json)
        if (nuevos == valores) return false
        valores = nuevos
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(KEY, JSONObject(nuevos as Map<*, *>).toString())
            .apply()
        return true
    }
}

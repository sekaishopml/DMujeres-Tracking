package com.dmujeres.app.sistema

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import androidx.preference.PreferenceManager
import com.dmujeres.app.red.DmujeresApi

/**
 * ¿El teléfono cerró la app en esta jornada y no la dejó volver enseguida?
 *
 * La alarma de supervisión la levanta en 3 min. Si tardó más, el ahorro del
 * fabricante la tiene frenada (Honor/Huawei "smartopt clean", iAware) y solo
 * se arregla con un ajuste del teléfono: la pantalla principal lo pide. Un
 * cierre que vuelve en segundos (Xiaomi con inicio automático) no se avisa.
 */
object CierreDelSistema {

    const val TARDANZA_MS = 4 * 60_000L

    private const val KEY_ATENDIDO = "cierreAtendidoMs"

    // Motivos de ApplicationExitInfo que decide el sistema: SIGNALED, LOW_MEMORY,
    // EXCESSIVE_RESOURCE_USAGE, USER_REQUESTED (detención forzada, quitar de
    // recientes), OTHER (limpiadores del fabricante) y FREEZER.
    private val MOTIVOS = setOf(2, 3, 9, 10, 13, 14)

    /** Una actualización también sale como USER_REQUESTED en algunos teléfonos. */
    fun esDelSistema(motivo: Int, detalle: String): Boolean =
        motivo in MOTIVOS && !detalle.contains("installPackage")

    fun debeAvisar(
        motivo: Int,
        detalle: String,
        cierreMs: Long,
        inicioJornadaMs: Long,
        vueltaMs: Long,
        atendidoMs: Long,
    ): Boolean = esDelSistema(motivo, detalle) && cierreMs >= inicioJornadaMs &&
        vueltaMs - cierreMs > TARDANZA_MS && cierreMs > atendidoMs

    // El último cierre no cambia mientras este proceso viva: se lee una vez.
    private var leido = false
    private var cierre: Triple<Int, String, Long>? = null

    /** Hora del cierre que hay que avisar, o null. */
    fun pendiente(context: Context): Long? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || !DmujeresApi.isJourneyOpen(context)) return null
        if (!leido) {
            leido = true
            cierre = runCatching {
                (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
                    .getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()
                    ?.let { Triple(it.reason, it.description.orEmpty(), it.timestamp) }
            }.getOrNull()
        }
        val (motivo, detalle, cierreMs) = cierre ?: return null
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val vueltaMs = System.currentTimeMillis() - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
        val inicio = prefs.getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, Long.MAX_VALUE)
        return cierreMs.takeIf { debeAvisar(motivo, detalle, it, inicio, vueltaMs, prefs.getLong(KEY_ATENDIDO, 0L)) }
    }

    /** Ya abrió el ajuste: no se vuelve a pedir hasta otro cierre. */
    fun atender(context: Context, cierreMs: Long) {
        PreferenceManager.getDefaultSharedPreferences(context).edit().putLong(KEY_ATENDIDO, cierreMs).apply()
    }
}

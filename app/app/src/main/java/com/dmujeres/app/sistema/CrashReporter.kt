package com.dmujeres.app.sistema

import android.content.Context
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.red.DmujeresApi
import java.io.File
import org.json.JSONObject

/**
 * Cierres inesperados de la app: guarda el error en un archivo y lo envía con
 * el diagnóstico al volver a abrirse (en el panel se ve en
 * `lastDiagnostics.crash`). Así se puede saber qué pasó sin conectar el
 * teléfono. No se envía en el momento: el proceso muere antes de terminar.
 */
object CrashReporter {

    private const val ARCHIVO = "last_crash.txt"

    fun install(context: Context) {
        enviarPendiente(context)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { File(context.filesDir, ARCHIVO).writeText(Log.getStackTraceString(error).take(8_000)) }
            previous?.uncaughtException(thread, error)
        }
    }

    /** El error del cierre anterior, si quedó guardado; se borra solo si llegó. */
    private fun enviarPendiente(context: Context) {
        val archivo = File(context.filesDir, ARCHIVO)
        val error = runCatching { archivo.takeIf { it.exists() }?.readText() }.getOrNull() ?: return
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val reporte = JSONObject()
            .put("app", JSONObject().put("versionCode", BuildConfig.VERSION_CODE).put("versionName", BuildConfig.VERSION_NAME))
            .put("crash", error.take(2_000))
            .put("journeyOpen", prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false))
        DmujeresApi.postDiagnostics(context, JSONObject().put("report", reporte)) { ok ->
            // Si mientras tanto hubo otro cierre, ese queda para la próxima.
            if (ok && runCatching { archivo.readText() }.getOrNull() == error) archivo.delete()
        }
    }
}

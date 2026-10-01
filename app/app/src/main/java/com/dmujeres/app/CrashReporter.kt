package com.dmujeres.app

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import org.json.JSONObject
import androidx.preference.PreferenceManager

/**
 * Cierres inesperados de la app: guarda el error en un archivo y lo envía con
 * el diagnóstico (en el panel se ve en `lastDiagnostics.crash`). Así se puede
 * saber qué pasó sin conectar el teléfono.
 */
object CrashReporter {

    private const val TAG = "CrashReporter"

    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                save(context, error)
            }
            runCatching {
                report(context, error)
            }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun save(context: Context, error: Throwable) {
        runCatching {
            File(context.filesDir, "last_crash.txt").writeText(
                stackOf(error).take(8_000),
            )
        }
    }

    /** Reporte al servidor con la misma forma del reporte de diagnósticos. */
    private fun report(context: Context, error: Throwable) {
        Thread {
            runCatching {
                val prefs = PreferenceManager.getDefaultSharedPreferences(context)
                val open = prefs.getBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
                DmujeresApi.postDiagnostics(
                    context,
                    JSONObject()
                        .put(
                            "report",
                            JSONObject()
                                .put(
                                    "app",
                                    JSONObject()
                                        .put("versionCode", BuildConfig.VERSION_CODE)
                                        .put("versionName", BuildConfig.VERSION_NAME),
                                )
                                .put("crash", stackOf(error).take(2_000))
                                .put("journeyOpen", open),
                        ),
                )
            }
        }.start()
    }

    private fun stackOf(error: Throwable): String {
        val writer = PrintWriter(StringWriter())
        error.printStackTrace(writer)
        return writer.toString()
    }
}

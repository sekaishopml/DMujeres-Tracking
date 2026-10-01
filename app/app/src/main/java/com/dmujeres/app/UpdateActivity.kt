package com.dmujeres.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Pantalla de actualización: el logo (en el mismo lugar que en la pantalla
 * principal), un círculo de carga y lo que está pasando: "Descargando… N%" y
 * después "Actualizando…".
 */
class UpdateActivity : AppCompatActivity() {

    private lateinit var progress: ProgressBar
    private lateinit var status: TextView
    private lateinit var detail: TextView
    private lateinit var retry: Button
    private lateinit var odometro: Odometro
    private var barra: android.animation.ObjectAnimator? = null
    private var pulso: android.animation.Animator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_update)
        Responsivo.raiz(this)?.let { Responsivo.centrar(it) }
        progress = findViewById(R.id.update_progress)
        status = findViewById(R.id.update_status)
        detail = findViewById(R.id.update_detail)
        retry = findViewById(R.id.update_retry)
        odometro = findViewById(R.id.update_odometro)
        odometro.setValor(0)
        val version = intent.getStringExtra(EXTRA_VERSION).orEmpty()
        if (version.isNotBlank()) {
            findViewById<TextView>(R.id.update_title).text = getString(R.string.update_title_fmt, version)
        }
        retry.setOnClickListener { download() }
        if (intent.getBooleanExtra(EXTRA_DEMO, false)) {
            // Menú de depuración: recorre el diseño sin descargar nada.
            simulate()
        } else {
            download()
        }
    }

    /** La barra se desliza hasta el nuevo valor, sin saltos. */
    private fun mostrarAvance(percent: Int) {
        odometro.setValor(percent)
        val destino = percent.coerceIn(0, 100) * 10
        barra?.cancel()
        barra = android.animation.ObjectAnimator.ofInt(progress, "progress", progress.progress, destino).apply {
            duration = 420
            interpolator = android.view.animation.DecelerateInterpolator(1.6f)
            start()
        }
    }

    /** Instalando: barra completa con un pulso suave mientras el sistema instala. */
    private fun faseInstalacion() {
        mostrarAvance(100)
        status.text = getString(R.string.update_installing)
        pulso?.cancel()
        pulso = android.animation.ObjectAnimator.ofFloat(progress, View.ALPHA, 1f, 0.35f, 1f).apply {
            duration = 1_400
            repeatCount = android.animation.ValueAnimator.INFINITE
            start()
        }
    }

    override fun onDestroy() {
        barra?.cancel()
        pulso?.cancel()
        super.onDestroy()
    }

    private fun download() {
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        val sha256 = intent.getStringExtra(EXTRA_SHA256).orEmpty()
        if (url.isBlank()) {
            finish()
            return
        }
        // Una sola descarga a la vez: volver a abrir la pantalla (o tocar
        // Reintentar) mientras baja escribía dos veces el mismo archivo.
        if (!downloading.compareAndSet(false, true)) return
        retry.visibility = Button.GONE
        progress.visibility = ProgressBar.VISIBLE
        progress.alpha = 1f
        pulso?.cancel()
        status.text = getString(R.string.update_downloading)
        mostrarAvance(0)
        Thread {
            try {
                runCatching { downloadAndInstall(url, sha256) }
            } finally {
                downloading.set(false)
            }
        }.start()
    }

    /**
     * Recorrido simulado del diseño (menú de depuración): "Descargando… N%"
     * con avance suave, luego "Actualizando…" y el cierre, sin descargar ni
     * instalar nada.
     */
    private fun simulate() {
        retry.visibility = Button.GONE
        progress.visibility = ProgressBar.VISIBLE
        status.text = getString(R.string.update_downloading)
        Thread {
            try {
                var percent = 0
                while (percent < 100) {
                    Thread.sleep(160)
                    percent = (percent + (1..4).random()).coerceAtMost(100)
                    val valor = percent
                    runOnUiThread { if (!isFinishing && !isDestroyed) mostrarAvance(valor) }
                }
                Thread.sleep(500)
                runOnUiThread { if (!isFinishing && !isDestroyed) faseInstalacion() }
                Thread.sleep(2_600)
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    pulso?.cancel()
                    progress.alpha = 1f
                    status.text = getString(R.string.update_demo_done)
                }
            } catch (e: InterruptedException) {
                // La pantalla se cerró: nada más que hacer.
            }
        }.start()
    }

    private fun downloadAndInstall(url: String, sha256: String) {
        try {
            val target = File(cacheDir, APK_NAME)
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            // Un 404/500 devolvía su página de error y se "instalaba" como APK
            // (el sistema decía "error al analizar el paquete").
            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "descarga respondió ${connection.responseCode}")
                connection.disconnect()
                showError()
                return
            }
            val total = connection.contentLengthLong
            var readTotal = 0L
            var lastPercent = -1
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        readTotal += read
                        val percent = if (total > 0) (readTotal * 100 / total).toInt() else -1
                        // Solo se actualiza la pantalla cuando cambia el
                        // porcentaje.
                        if (percent >= 0 && percent != lastPercent) {
                            lastPercent = percent
                            runOnUiThread { if (!isFinishing && !isDestroyed) mostrarAvance(percent) }
                        }
                    }
                }
            }
            connection.disconnect()
            // La descarga se cortó: no se instala a medias.
            if (total > 0 && readTotal != total) {
                Log.w(TAG, "descarga incompleta: $readTotal de $total bytes")
                target.delete()
                showError()
                return
            }
            if (sha256.isNotBlank() && !sha256.equals(sha256Of(target), ignoreCase = true)) {
                Log.w(TAG, "sha256 no coincide; se descarta la descarga")
                target.delete()
                showError()
                return
            }
            runOnUiThread { if (!isFinishing && !isDestroyed) faseInstalacion() }
            install(target)
        } catch (e: Exception) {
            Log.w(TAG, "Descarga de actualización falló", e)
            showError()
        }
    }

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(this, packageName + ".fileprovider", file)
        runOnUiThread {
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            finish()
        }
    }

    private fun showError() {
        // Si falla o se cancela no se guarda nada que oculte el aviso: vuelve
        // a salir al abrir la app o al minuto siguiente, mientras la versión
        // publicada sea mayor. La descarga a medias se reemplaza en el próximo
        // intento.
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            pulso?.cancel()
            progress.alpha = 1f
            status.text = getString(R.string.update_download_failed)
            retry.visibility = Button.VISIBLE
        }
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val TAG = "UpdateActivity"
        private val downloading = java.util.concurrent.atomic.AtomicBoolean(false)
        private const val APK_NAME = "dmujeres-update.apk"
        const val EXTRA_URL = "update_url"
        const val EXTRA_SHA256 = "update_sha256"
        const val EXTRA_VERSION = "update_version"
        private const val EXTRA_DEMO = "update_demo"

        /** Abre la pantalla de carga; si falta el permiso, manda a Ajustes. */
        fun start(activity: Activity, url: String, sha256: String, version: String = "") {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O &&
                !activity.packageManager.canRequestPackageInstalls()
            ) {
                runCatching {
                    activity.startActivity(
                        Intent(
                            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${activity.packageName}"),
                        ),
                    )
                }
                Toast.makeText(activity, R.string.update_allow_installs, Toast.LENGTH_LONG).show()
                return
            }
            activity.startActivity(
                Intent(activity, UpdateActivity::class.java)
                    .putExtra(EXTRA_URL, url)
                    .putExtra(EXTRA_SHA256, sha256)
                    .putExtra(EXTRA_VERSION, version),
            )
        }

        /** Recorrido simulado del diseño, desde el menú de depuración. */
        fun startDemo(activity: Activity) {
            activity.startActivity(
                Intent(activity, UpdateActivity::class.java)
                    .putExtra(EXTRA_DEMO, true),
            )
        }
    }
}

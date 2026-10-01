package com.dmujeres.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Pantalla de arranque: fondo blanco y el logo completo (la de Android 12 o
 * más recorta el ícono en círculo). Dura [DURACION_MS] y sigue a la pantalla
 * principal, o al asistente si falta configurar.
 */
class SplashActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val continuar = Runnable {
        if (isFinishing || isDestroyed) return@Runnable
        startActivity(Intent(this, MainActivity::class.java))
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Si la app ya estaba abierta, no se repite la espera.
        if (!isTaskRoot && intent?.action == Intent.ACTION_MAIN) {
            finish()
            return
        }
        setContentView(R.layout.activity_splash)
        val suave = PathInterpolator(0.22f, 1f, 0.36f, 1f)
        findViewById<ImageView>(R.id.splash_logo).apply {
            scaleX = 0.94f
            scaleY = 0.94f
            animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(700).setInterpolator(suave).start()
        }
        findViewById<View>(R.id.splash_loader).animate().alpha(1f).setStartDelay(300).setDuration(500).start()
        findViewById<TextView>(R.id.splash_version).apply {
            text = getString(R.string.version_format, BuildConfig.VERSION_NAME)
            animate().alpha(1f).setStartDelay(400).setDuration(600).start()
        }
        handler.postDelayed(continuar, DURACION_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(continuar)
        super.onDestroy()
    }

    private companion object {
        const val DURACION_MS = 5_000L
    }
}

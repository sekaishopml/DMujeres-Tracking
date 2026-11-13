/*
 * Copyright 2017 - 2021 Anton Tananaev (anton@traccar.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.dmujeres.app.pantallas

import androidx.core.widget.doAfterTextChanged
import android.widget.EditText
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.R
import com.dmujeres.app.actualizacion.OtaPolicy
import com.dmujeres.app.avisos.AvisosHorarios
import com.dmujeres.app.datos.Ajustes
import com.dmujeres.app.datos.ConfigState
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.datos.RefreshOutcome
import com.dmujeres.app.datos.RefreshSummary
import com.dmujeres.app.sistema.AjustesPermisos
import com.dmujeres.app.sistema.CierreDelSistema
import com.dmujeres.app.sistema.EstadoTelefono
import com.dmujeres.app.sistema.OemAutostart
import com.dmujeres.app.sistema.ServiceHeartbeat
import com.dmujeres.app.datos.RemoteConfig
import com.dmujeres.app.red.ConnectionState
import com.dmujeres.app.red.EstadoEnvio
import com.dmujeres.app.jornada.ReglasJornada
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.red.NetworkManager
import com.dmujeres.app.seguimiento.PositionProvider
import com.dmujeres.app.seguimiento.TrackingService
import com.dmujeres.app.sesion.SessionStore

/** Refresco en vivo del home (estado, pendientes, batería y duración). */
private const val LIVE_REFRESH_MS = 5_000L
private const val AVISOS_MS = 1_500L
private const val DURACION_AVISO_VERDE_MS = 4_000L

/** Extra del menú de depuración para probar la animación del banner. */
const val EXTRA_BANNER_DEMO = "bannerDemo"

/** Marca del último chequeo de actualización (para el freno). */
private const val KEY_LAST_OTA_CHECK = "lastOtaCheckApp"
private const val KEY_OTA_INTENTO = "otaIntentoSolo"
private const val REINTENTO_OTA_MS = 20 * 60_000L

/** Pasos visibles del refresco manual (para el relleno proporcional). */
private const val REFRESH_STEPS = 3
private const val REQUEST_PERMISO_UBICACION = 201
private const val REQUEST_PERMISO_ACTIVIDAD = 202
private const val PAUSA_REFRESCO_MS = 10_000L

/** Bloqueo del botón de jornada tras un toque (anti doble toque). */
private const val JOURNEY_TAP_GUARD_MS = 600L

/** Tiempo para el segundo toque que confirma el fin de la jornada. */
private const val CONFIRMAR_FIN_MS = 5_000L

/** Pendientes a partir de los cuales el estado pasa a "Sin conexión". */
private const val PENDING_OFFLINE_THRESHOLD = 30

/** Aviso "inicia la jornada" en el botón ACTUALIZAR (luego vuelve solo). */

/** Naranja de aviso: el refresco terminó con algo fallando. */
private val REFRESH_WARNING_COLOR = 0xFFE65100.toInt()

class MainActivity : AppCompatActivity() {

    private var lastJourneyTapAt = 0L

    private var tapCount = 0
    private var tapFirstAt = 0L
    private var tapLastAt = 0L

    /** Último número de posiciones en el búfer, leído por el refresco de la tarjeta. */
    @Volatile
    private var cachedPending = 0
    /** Último estado de envío mostrado (ver [EstadoEnvio]). */
    private var envio = EstadoEnvio.EN_LINEA

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        // Reparación: equipos ya configurados (con usuario y asistente
        // completado alguna vez) que perdieron la marca por la vista previa
        // antigua del menú de depuración vuelven al inicio normal.
        if (!prefs.getBoolean(Prefs.ONBOARDED, false) &&
            (prefs.getLong(Prefs.ONBOARDED_AT, 0L) > 0L || SessionStore.state(this).hasSession())
        ) {
            prefs.edit().putBoolean(Prefs.ONBOARDED, true).apply()
        }
        if (!prefs.getBoolean(Prefs.ONBOARDED, false)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        // El servicio queda siempre encendido (no hay interruptor).
        prefs.edit().putBoolean(Prefs.STATUS, true).apply()
        ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
        // Config remota al abrir: si cambió y el servicio ya corre, se reinicia
        // una sola vez (con guardas: ver RemoteConfig.restartService).
        RemoteConfig.applyAndRestartIfChanged(this)
        // No hay pantalla de ajustes: la configuración llega del servidor. El
        // menú de depuración se abre con 5 toques en la versión.
        setContentView(R.layout.activity_locked_home)
        adaptarATablet()
        wireLockedHome()
        // Al entrar se presenta la ayuda; al girar la pantalla, no.
        presentarAyuda(animar = savedInstanceState == null)
        animarEntrada(savedInstanceState == null)
        // Al abrir la app siempre se busca actualización. Al girar la pantalla
        // no se vuelve a buscar.
        maybeCheckOta(force = savedInstanceState == null)
        if (intent.getBooleanExtra(EXTRA_BANNER_DEMO, false)) {
            showBannerDemo()
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_BANNER_DEMO, false)) {
            showBannerDemo()
        }
    }

    /**
     * Busca actualización. Al abrir la app, siempre; con la app abierta (al
     * volver a ella o cada minuto), como mucho una vez por minuto (ver
     * OtaPolicy). La hora del último chequeo se guarda al terminar, para que si
     * la pantalla se cierra a mitad se vuelva a intentar enseguida. El aviso
     * sale siempre que la versión publicada sea mayor que la instalada, y la
     * actualización se abre sola (ver [intentarSola]).
     */
    private fun maybeCheckOta(force: Boolean = false) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_OTA_CHECK, 0L)
        if (!force && !OtaPolicy.shouldCheck(now, last, coldStart = false)) return
        showUpdateDialogIfAvailable(automatica = true) {
            prefs.edit().putLong(KEY_LAST_OTA_CHECK, System.currentTimeMillis()).apply()
        }
    }

    /**
     * Banner superior de actualización: pegado al borde de arriba, baja
     * deslizándose y empuja el home; al tocarlo descarga e instala. Se revisa
     * en vivo (al abrir, al volver y cada minuto con la app abierta).
     */
    private fun showUpdateDialogIfAvailable(automatica: Boolean = false, onDone: (() -> Unit)? = null) {
        DmujeresApi.checkOta(this) { label, url, sha256 ->
            runOnUiThread {
                onDone?.invoke()
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (label == null) return@runOnUiThread
                showUpdateBanner(url, sha256, version = label)
                if (automatica && intentarSola(label)) UpdateActivity.start(this, url, sha256, label)
            }
        }
    }

    /**
     * ¿Se abre la actualización sola? Al abrir la app, al volver a ella y con
     * la app abierta, salvo que la persona esté escribiendo (actividad, nota o
     * motivo de cierre). Sin permiso de instalar sin confirmar, se descarga y
     * Android pide un toque. Si la persona lo cancela, se vuelve a intentar a
     * los 20 min: insiste sin trabar el trabajo.
     */
    private fun intentarSola(version: String): Boolean {
        if (actividadExpress?.ocupada() == true) return false
        if (findViewById<View>(R.id.fin_nota_panel)?.visibility == View.VISIBLE) return false
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val previo = prefs.getString(KEY_OTA_INTENTO, null)?.split("|")
        val ahora = System.currentTimeMillis()
        val reciente = previo?.getOrNull(0) == version && ahora - (previo.getOrNull(1)?.toLongOrNull() ?: 0L) < REINTENTO_OTA_MS
        if (reciente) return false
        prefs.edit().putString(KEY_OTA_INTENTO, "$version|$ahora").apply()
        return true
    }

    /**
     * Aviso de actualización: baja desde arriba y, como flota, solo corre el
     * botón de la consola; el resto de la pantalla no se mueve.
     */
    private fun showUpdateBanner(url: String, sha256: String, demo: Boolean = false, version: String = "") {
        if (isFinishing || isDestroyed) return
        val banner = findViewById<LinearLayout>(R.id.update_banner) ?: return
        // El banner dice a qué versión se actualiza.
        findViewById<TextView>(R.id.banner_text)?.text = if (version.isNotBlank()) {
            getString(R.string.update_banner_fmt, version)
        } else {
            getString(R.string.update_banner_text)
        }
        // Se usa siempre la última url publicada: si sale otra versión con el
        // aviso ya visible, tocarlo descarga la más nueva.
        banner.setOnClickListener {
            if (demo) {
                hideUpdateBanner()
                Toast.makeText(this, getString(R.string.debug_banner_demo_done), Toast.LENGTH_SHORT).show()
            } else {
                UpdateActivity.start(this, url, sha256, version)
            }
        }
        if (banner.visibility == View.VISIBLE) return
        if (!demo && version.isNotBlank()) {
            StatusActivity.addMessage(getString(R.string.console_update_fmt, version))
        }
        startBannerPulse()
        val console = findViewById<android.widget.ImageButton>(R.id.console_button)
        val height = (46 * resources.displayMetrics.density).toInt()
        val slide = android.view.animation.DecelerateInterpolator()
        banner.visibility = View.VISIBLE
        banner.translationY = -height.toFloat()
        banner.animate().translationY(0f).setDuration(420).setInterpolator(slide).start()
        // La consola y la ayuda acompañan la bajada para quedar visibles debajo.
        console?.animate()?.translationY(height.toFloat())?.setDuration(420)?.setInterpolator(slide)?.start()
        findViewById<View>(R.id.ayuda_boton)?.animate()?.translationY(height.toFloat())?.setDuration(420)?.setInterpolator(slide)?.start()
    }

    private var bannerPulse: android.animation.Animator? = null

    /**
     * Pulso sutil del ícono del banner (escala y opacidad, 1.6 s): llama la
     * atención sin mover el texto.
     */
    private fun startBannerPulse() {
        val icon = findViewById<android.widget.ImageView>(R.id.banner_icon) ?: return
        bannerPulse?.cancel()
        val scaleX = android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.18f, 1f)
        val scaleY = android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.18f, 1f)
        val alpha = android.animation.PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.65f, 1f)
        bannerPulse = android.animation.ObjectAnimator.ofPropertyValuesHolder(icon, scaleX, scaleY, alpha).apply {
            duration = 1_600
            repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            start()
        }
    }

    override fun onDestroy() {
        bannerPulse?.cancel()
        super.onDestroy()
    }

    /** Sube el banner y devuelve la hamburguesa a su sitio (misma suavidad). */
    private fun hideUpdateBanner() {
        val banner = findViewById<LinearLayout>(R.id.update_banner) ?: return
        val console = findViewById<android.widget.ImageButton>(R.id.console_button)
        val height = (46 * resources.displayMetrics.density).toInt()
        val slide = android.view.animation.DecelerateInterpolator()
        banner.animate().translationY(-height.toFloat()).setDuration(320).setInterpolator(slide)
            .withEndAction { banner.visibility = View.GONE }
            .start()
        console?.animate()?.translationY(0f)?.setDuration(320)?.setInterpolator(slide)?.start()
        findViewById<View>(R.id.ayuda_boton)?.animate()?.translationY(0f)?.setDuration(320)?.setInterpolator(slide)?.start()
    }

    /** Menú de depuración: muestra la animación del banner sin tocar la OTA. */
    private fun showBannerDemo() {
        val banner = findViewById<LinearLayout>(R.id.update_banner)
        if (banner?.visibility == View.VISIBLE) {
            // Reinicia para poder repetir la animación las veces que haga falta.
            banner.visibility = View.GONE
            banner.translationY = 0f
            findViewById<android.widget.ImageButton>(R.id.console_button)?.translationY = 0f
            findViewById<View>(R.id.ayuda_boton)?.translationY = 0f
        }
        showUpdateBanner("", "", demo = true)
    }

    private var durationTicker: Runnable? = null

    /** Pantalla principal: logo, banner de estado, 3 cuadros y botón de jornada.
     *  Mismo orden y colores del panel: banner rojo (sin jornada) / verde
     *  (en jornada), cuadros de Pendientes, Batería y Duración, y skeleton
     *  pulsante mientras cargan los datos. Sin scroll. */
    private fun wireLockedHome() {
        val button = findViewById<Button>(R.id.journey_button)
        val version = findViewById<TextView>(R.id.version_label)
        val updateButton = findViewById<Button>(R.id.update_button)
        // Consola de estado, arriba a la derecha.
        findViewById<android.widget.ImageButton>(R.id.console_button).setOnClickListener {
            startActivity(Intent(this, StatusActivity::class.java))
        }
        // Actividad: inicio rápido y la que está en curso (abre también el cronograma).
        actividadExpress = ActividadExpress(this)

        button.setOnClickListener {
            // Anti doble toque: el botón se bloquea un instante mientras cambia
            // de estado (dos toques rápidos abrían y cerraban la jornada).
            if (SystemClock.elapsedRealtime() - lastJourneyTapAt < JOURNEY_TAP_GUARD_MS) return@setOnClickListener
            lastJourneyTapAt = SystemClock.elapsedRealtime()
            if (DmujeresApi.isJourneyOpen(this)) {
                // En horario laboral se finaliza solo con el motivo escrito.
                if (ReglasJornada.pideNota(minutoDelDia())) {
                    mostrarNota(findViewById<View>(R.id.fin_nota_panel).visibility != View.VISIBLE, inicio = false)
                    return@setOnClickListener
                }
                // Sin ventana de confirmación: el primer toque avisa en el
                // mismo botón y el segundo, dentro de unos segundos, finaliza.
                if (finArmado()) {
                    finArmadoHasta = 0L
                    DmujeresApi.journeyEnded(this)
                } else {
                    finArmadoHasta = SystemClock.elapsedRealtime() + CONFIRMAR_FIN_MS
                    uiHandler.postDelayed({ runCatching { refreshLockedHome() } }, CONFIRMAR_FIN_MS + 50)
                }
                refreshLockedHome()
            } else {
                // Sin los permisos que mantienen la captura y las notificaciones
                // la jornada no arranca: se abre lo que falta (el aviso en rojo
                // de esta pantalla dice qué es).
                if (!journeyPermissionsGranted()) {
                    if (AjustesPermisos.ubicacion(this) && !AjustesPermisos.ubicacionSiempre(this)) {
                        // Solo falta "todo el tiempo": directo a ese permiso.
                        AjustesPermisos.abrirUbicacion(this)
                    } else {
                        OnboardingActivity.start(this, OnboardingActivity.STEP_PERMISSIONS)
                    }
                    return@setOnClickListener
                }
                // Iniciar tarde (de fábrica desde las 09:00) pide el motivo.
                val dia = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("America/Guayaquil"))
                    .get(java.util.Calendar.DAY_OF_WEEK)
                val desde = Ajustes.valor(Ajustes.Clave.INICIO_CON_MOTIVO_DESDE_MIN).toInt()
                if (ReglasJornada.pideNotaInicio(minutoDelDia(), desde, AvisosHorarios.diaHabil(dia))) {
                    mostrarNota(findViewById<View>(R.id.fin_nota_panel).visibility != View.VISIBLE, inicio = true)
                    return@setOnClickListener
                }
                iniciarJornada(null)
            }
        }
        findViewById<View>(R.id.fin_nota_volver).setOnClickListener { mostrarNota(false, notaParaInicio) }
        findViewById<View>(R.id.fin_nota_finalizar).setOnClickListener {
            val nota = findViewById<EditText>(R.id.fin_nota_campo).text.toString().trim()
            if (!ReglasJornada.notaValida(nota)) {
                findViewById<View>(R.id.fin_nota_error).visibility = View.VISIBLE
                return@setOnClickListener
            }
            if (notaParaInicio) {
                mostrarNota(false, inicio = true)
                iniciarJornada(nota)
                return@setOnClickListener
            }
            DmujeresApi.journeyEnded(this, "manual", nota)
            mostrarNota(false, inicio = false)
            refreshLockedHome()
        }
        findViewById<EditText>(R.id.fin_nota_campo).doAfterTextChanged {
            findViewById<View>(R.id.fin_nota_error).visibility = View.GONE
        }
        Animaciones.respuestaAlToque(findViewById(R.id.fin_nota_finalizar), findViewById(R.id.fin_nota_volver))
        // ACTUALIZAR: reenvía lo pendiente, pide una ubicación nueva y revisa
        // el servicio. El avance se ve dentro del botón: el texto cambia con
        // cada paso y el relleno avanza de izquierda a derecha. La
        // actualización de la app es el aviso de arriba.
        updateButton.setOnClickListener {
            // Mientras muestra un problema que se arregla en el teléfono, el
            // toque lleva al ajuste (GPS o ahorro de batería).
            accionPendiente?.let { accion ->
                accionPendiente = null
                accion()
                return@setOnClickListener
            }
            // Tocarlo seguido no repite todo: el botón dice cuánto falta para volver a usarlo.
            if (!refreshing && SystemClock.elapsedRealtime() - ultimoRefresco < PAUSA_REFRESCO_MS && ultimoResumen != null) {
                mostrarEspera()
                return@setOnClickListener
            }
            runProgressiveRefresh()
        }
        version.text = getString(
            R.string.version_footer_fmt,
            BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_CODE,
        )
        version.setOnClickListener { onVersionTap() }
        // Mientras cargan los datos, los cuadros laten (la batería es inmediata;
        // la cola se lee en otro hilo).
        val skeleton = findViewById<View>(R.id.skeleton_group)
        val content = findViewById<View>(R.id.home_content)
        val anim = android.animation.ValueAnimator.ofFloat(1.0f, 0.4f, 1.0f).apply {
            duration = 900
            repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.LinearInterpolator()
        }
        anim.addUpdateListener { skeleton.alpha = it.animatedValue as Float }
        anim.start()
        Thread {
            val pendingCount = try {
                DatabaseHelper(this).countPositions()
            } catch (e: Exception) {
                0
            }
            runOnUiThread {
                anim.cancel()
                skeleton.visibility = View.GONE
                content.visibility = View.VISIBLE
                refreshLockedHome()
            }
        }.start()

        // El tiempo de jornada avanza cada 30 s mientras la pantalla esté abierta.
        // Refresco vivo: estado, pendientes, batería y duración cada 5 s.
        durationTicker = object : Runnable {
            override fun run() {
                if (isFinishing || isDestroyed) return
        // Primero se reprograma y después se refresca: si algo falla, el
        // reloj no se detiene.
                uiHandler.postDelayed(this, LIVE_REFRESH_MS)
                runCatching { refreshLockedHome() }
                // Banner en vivo: con la app abierta se revisa cada minuto.
                runCatching { maybeCheckOta() }
                runCatching { maybeAskLogin() }
            }
        }
        refreshLockedHome()
        // El reloj lo arranca onResume, que siempre corre después de onCreate.
    }


    /** Banner de estado (3 colores), cuadros y botón con el estado real. */
    private val uiHandler = android.os.Handler(android.os.Looper.getMainLooper())

    /** Cambia el estado de la pill con una transición suave de color y texto. */
    private fun applyPillState(pill: LinearLayout, text: TextView, bgRes: Int, label: String, textColorRes: Int) {
        Animaciones.fondo(pill, bgRes)
        Animaciones.texto(text, label)
        text.setTextColor(getColor(textColorRes))
    }

    /** Entrada escalonada de las tarjetas y respuesta al toque en los botones. */
    private fun animarEntrada(conEntrada: Boolean) {
        Animaciones.respuestaAlToque(
            findViewById(R.id.journey_button), findViewById(R.id.update_button),
            findViewById(R.id.ayuda_boton), findViewById(R.id.permission_warning),
        )
        // Lo de abajo aparece al llegar a ello desplazando.
        findViewById<ViewGroup>(R.id.cuerpo)?.let { c -> (c.parent as? ViewGroup)?.let { Animaciones.alDesplazar(it, c) } }
        if (!conEntrada) return
        val tarjetas = listOf(
            R.id.tarjeta_jornada, R.id.actividad_card, R.id.skeleton_group, R.id.fila_jornada,
        ).mapNotNull { findViewById<View>(it) }
        Animaciones.entradaEscalonada(tarjetas)
        // El resumen aparece en lugar del cuadro vacío: se anima el contenedor de ambos.
        findViewById<View>(R.id.home_content)?.let { Animaciones.entradaEscalonada(listOf(it), 30 + 2 * 40L) }
    }

    // Lo último que se sabe del día, para decir qué toca hacer ahora.
    private var ubicacionActiva = true
    private var firmaEstado = ""

    /** Frase de la tarjeta principal según el estado real; cambia con un fundido. */
    private fun actualizarSugerencia() {
        val texto = findViewById<TextView>(R.id.sugerencia_texto) ?: return
        val fila = findViewById<View>(R.id.sugerencia) ?: return
        val abierta = DmujeresApi.isJourneyOpen(this)
        // Con el aviso rojo (o verde) a la vista, ocupa su lugar: no se repite.
        val conAviso = findViewById<View>(R.id.permission_warning)?.visibility == View.VISIBLE
        // Solo lo urgente: las actividades ya se leen debajo, en la misma tarjeta.
        val mensaje = when {
            conAviso -> null
            abierta && finArmado() -> getString(R.string.sug_confirmar)
            !ubicacionActiva -> getString(R.string.sug_ubicacion)
            !abierta -> getString(R.string.sug_iniciar)
            envio == EstadoEnvio.SERVIDOR_NO_RESPONDE -> getString(R.string.sug_servidor_no_responde)
            cachedPending >= PENDING_OFFLINE_THRESHOLD -> getString(R.string.sug_pendientes_fmt, cachedPending)
            envio == EstadoEnvio.SIN_INTERNET ->
                if (cachedPending > 0) getString(R.string.sug_pendientes_fmt, cachedPending) else getString(R.string.sug_sin_conexion)
            else -> null
        }
        val visible = if (mensaje == null) View.GONE else View.VISIBLE
        if (fila.visibility != visible) {
            findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.suave(it) }
            fila.visibility = visible
        }
        if (mensaje == null) {
            texto.text = ""
            texto.tag = null
            return
        }
        if (texto.text.isNullOrEmpty()) {
            texto.text = mensaje
            return
        }
        // La tarjeta puede cambiar de alto: el resto de la pantalla se acomoda con suavidad.
        if (((texto.tag as? String) ?: texto.text.toString()) != mensaje) {
            findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.suave(it) }
        }
        Animaciones.texto(texto, mensaje)
    }

    private fun saludo(): String {
        val hora = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("America/Guayaquil"))
            .get(java.util.Calendar.HOUR_OF_DAY)
        val base = getString(
            when {
                hora < 12 -> R.string.saludo_dia
                hora < 19 -> R.string.saludo_tarde
                else -> R.string.saludo_noche
            },
        )
        val nombre = SessionStore.state(this).displayName.trim().substringBefore(' ')
        return if (nombre.isBlank()) base else getString(R.string.saludo_nombre_fmt, base, nombre)
    }

    /**
     * Un toque fuera del campo que se está escribiendo cierra el teclado; el
     * toque sigue su curso (si cae en un botón, el botón responde igual).
     */
    override fun dispatchTouchEvent(ev: android.view.MotionEvent): Boolean {
        val campo = currentFocus
        if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN && campo is android.widget.EditText) {
            val zona = android.graphics.Rect().also { campo.getGlobalVisibleRect(it) }
            if (!zona.contains(ev.rawX.toInt(), ev.rawY.toInt())) {
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .hideSoftInputFromWindow(campo.windowToken, 0)
                campo.clearFocus()
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onResume() {
        super.onResume()
        com.dmujeres.app.actualizacion.OtaNotifier.pantallaAbierta = true
        com.dmujeres.app.actualizacion.OtaNotifier.quitarAvisoActualizada(this)
        // Refresco inmediato + vivo cada 5 s mientras la pantalla esté abierta.
        runCatching { refreshLockedHome() }
        // Los avisos se miran cada 1,5 s: el rojo sale al instante.
        uiHandler.removeCallbacks(tickAvisos)
        uiHandler.post(tickAvisos)
        durationTicker?.let {
            uiHandler.removeCallbacks(it)
            uiHandler.postDelayed(it, LIVE_REFRESH_MS)
        }
        // Avisos de jornada que quedaron sin enviar (sin señal al tocar).
        DmujeresApi.flushJourneyEvents(this)
        // Cronograma del mes al día para el resumen de la tarjeta.
        run {
            val zona = java.util.TimeZone.getTimeZone("America/Guayaquil")
            val c = java.util.Calendar.getInstance(zona)
            val f = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }
            c.set(java.util.Calendar.DAY_OF_MONTH, 1)
            val desde = f.format(c.time)
            c.set(java.util.Calendar.DAY_OF_MONTH, c.getActualMaximum(java.util.Calendar.DAY_OF_MONTH))
            val hasta = f.format(c.time)
            com.dmujeres.app.cronograma.Actividades.sincronizar(this) {
                com.dmujeres.app.cronograma.Actividades.actualizar(this, desde, hasta) {
                    runOnUiThread { if (!isFinishing && !isDestroyed) refreshCronograma() }
                }
            }
        }
        // Y chequeo de actualización (con freno) al volver a la app.
        maybeCheckOta()
        maybeAskLogin()
    }

    override fun onPause() {
        super.onPause()
        com.dmujeres.app.actualizacion.OtaNotifier.pantallaAbierta = false
        // En segundo plano no se refresca (ahorra batería); al volver, sigue.
        durationTicker?.let { uiHandler.removeCallbacks(it) }
        uiHandler.removeCallbacks(tickEspera)
        uiHandler.removeCallbacks(tickAvisos)
        enEspera = false
    }

    private val tickAvisos = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            runCatching { revisarAvisos() }
            uiHandler.postDelayed(this, AVISOS_MS)
        }
    }

    private fun refreshLockedHome() {
        if (isFinishing || isDestroyed) return
        val open = DmujeresApi.isJourneyOpen(this)
        // Si la jornada se cerró (o, al pedir el motivo para iniciar, se abrió)
        // por otro lado, el recuadro del motivo ya no sirve.
        if (open == notaParaInicio && findViewById<View>(R.id.fin_nota_panel)?.visibility == View.VISIBLE) {
            findViewById<View>(R.id.fin_nota_panel)?.visibility = View.GONE
            findViewById<View>(R.id.journey_button)?.visibility = View.VISIBLE
        }
        val running = TrackingService.isRunning
        // Si la ubicación del sistema está apagada no hay ruta: se avisa en la
        // píldora y en el aviso de arriba.
        val locationOn = runCatching {
            (getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager)
                .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        }.getOrDefault(true)
        ubicacionActiva = locationOn
        revisarAvisos()
        // Si se apagan o encienden las notificaciones, el panel lo sabe enseguida.
        ServiceHeartbeat.avisarSiCambianNotificaciones(this)
        val pill = findViewById<LinearLayout>(R.id.status_pill)
        val pillText = findViewById<TextView>(R.id.pill_text)
        val button = findViewById<Button>(R.id.journey_button)
        val updateButton = findViewById<Button>(R.id.update_button)

        // Estados que se ven en el teléfono: EN LÍNEA (verde), SIN CONEXIÓN
        // (naranja), DESHABILITADO (gris, sin jornada) y UBICACIÓN APAGADA
        // (rojo, tiene prioridad). "Detenido" solo se muestra en el panel.
        // Sin red del teléfono también es "Sin señal", aunque no haya fallos de envío aún.
        val sinRed = EstadoTelefono.conexion(this) == "ninguna"
        envio = ConnectionState.estado(!sinRed, EstadoTelefono.internetValidado(this))
        val target = when {
            !locationOn -> Triple(R.drawable.bg_pill_red, getString(R.string.pill_sin_senal), R.color.white)
            !open -> Triple(R.drawable.bg_pill_gray, getString(R.string.pill_disabled), R.color.white)
            envio == EstadoEnvio.SERVIDOR_NO_RESPONDE ->
                Triple(R.drawable.bg_pill_orange, getString(R.string.pill_servidor_no_responde), R.color.white)
            envio == EstadoEnvio.SIN_INTERNET || (sinRed && cachedPending > 0) ->
                Triple(R.drawable.bg_pill_orange, getString(R.string.pill_sin_internet), R.color.white)
            else -> Triple(R.drawable.bg_pill_green, getString(R.string.pill_online), R.color.white)
        }
        if (!open) finArmadoHasta = 0L
        // Cuando cambia el estado de fondo, lo que cuelga de la tarjeta se acomoda con suavidad.
        val firma = "$open|${finArmado()}|$locationOn|$envio|$sinRed"
        if (firma != firmaEstado) {
            if (firmaEstado.isNotEmpty()) findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.suave(it) }
            firmaEstado = firma
        }
        applyPillState(pill, pillText, target.first, target.second, target.third)
        findViewById<TextView>(R.id.saludo_texto)?.text = saludo()
        Animaciones.fondo(
            button,
            if (open) R.drawable.bg_button_primary else R.drawable.bg_button_green,
        )
        Animaciones.texto(
            button,
            getString(
                when {
                    open && finArmado() -> R.string.journey_confirm_tap
                    open -> R.string.journey_stop_upper
                    else -> R.string.journey_start_upper
                },
            ),
        )
        // ACTUALIZAR se ve apagado (texto gris) sin jornada abierta; un refresco,
        // el aviso en curso o la cuenta de espera mandan sobre este reposo.
        if (!refreshing && !enEspera) {
            updateButton.text = getString(R.string.refresh_button)
            updateButton.setTextColor(updateButtonIdleColor())
        }

        val battery = readBattery()
        // Si el sistema no da la batería se muestra "--%".
        findViewById<TextView>(R.id.battery_value)?.text =
            if (battery.first < 0) "--%" else getString(R.string.battery_value_fmt, battery.first)
        findViewById<TextView>(R.id.battery_value)?.setTextColor(
            getColor(
                when {
                    battery.first < 0 -> R.color.muted
                    battery.first <= 15 -> R.color.primary
                    battery.first <= 35 -> android.R.color.holo_orange_dark
                    else -> R.color.status_ok
                },
            ),
        )
        // La cola de puntos se vuelve a leer en cada refresco (cada 30 s).
        Thread {
            val pending = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(0)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                // Guardamos el valor para la píldora y la sugerencia.
                cachedPending = pending
                findViewById<TextView>(R.id.pending_value)?.let {
                    // Sin salto: en movimiento cambia cada pocos segundos y mareaba.
                    if (it.text.toString() != pending.toString()) it.text = pending.toString()
                }
                actualizarSugerencia()
            }
        }.start()
        refreshDuration()
        refreshCronograma()
    }

    /**
     * Tablet: el contenido se centra con un ancho máximo. El pie azul sigue
     * a todo el ancho y el aviso flotante se alinea con él.
     */
    private fun adaptarATablet() {
        if (!Responsivo.esTablet(this)) return
        val ancho = Responsivo.ANCHO_COLUMNA_DP
        val columnas = Responsivo.raiz(this)?.getChildAt(0) as? android.view.ViewGroup ?: return
        Responsivo.centrarHijos(columnas, ancho)
        val extra = Responsivo.margenLateralPx(this, ancho)
        findViewById<View>(R.id.update_banner)?.let { banner ->
            (banner.layoutParams as? android.view.ViewGroup.MarginLayoutParams)?.let { lp ->
                lp.marginStart += extra
                lp.marginEnd += extra
                banner.layoutParams = lp
            }
        }
    }

    private var actividadExpress: ActividadExpress? = null

    private fun refreshCronograma() {
        val zona = java.util.TimeZone.getTimeZone("America/Guayaquil")
        val hoy = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }.format(java.util.Date())
        val actividades = com.dmujeres.app.cronograma.Actividades
        val delDia = actividades.delDia(this, hoy)
        findViewById<TextView>(R.id.actividades_value)?.let {
            if (it.text.toString() != delDia.size.toString()) {
                val primera = it.text.toString() == "—"
                it.text = delDia.size.toString()
                if (!primera) Animaciones.pulso(it)
            }
        }
        actualizarSugerencia()
        actividadExpress?.refrescar()
        val pendientes = actividades.pendientes(this)
        val sync = actividades.sincronizadoEn(this)
        findViewById<TextView>(R.id.crono_sync_home)?.text = when {
            pendientes > 0 -> getString(R.string.crono_sync_pend_corto_fmt, pendientes)
            sync > 0 -> getString(R.string.crono_sync_at_fmt, java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).apply { timeZone = zona }.format(java.util.Date(sync)))
            else -> getString(R.string.crono_sync_nunca)
        }
    }

    private fun refreshDuration() {
        val text = findViewById<TextView>(R.id.duration_value) ?: return
        refreshJourneyReceipt()
        if (!DmujeresApi.isJourneyOpen(this)) {
            text.text = getString(R.string.journey_none_banner)
            return
        }
        val startedAt = PreferenceManager.getDefaultSharedPreferences(this)
            .getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L)
        if (startedAt <= 0L) {
            text.text = getString(R.string.journey_none_banner)
            return
        }
        val minutes = ((System.currentTimeMillis() - startedAt) / 60_000L).toInt()
        text.text = getString(R.string.journey_duration_fmt, minutes / 60, minutes % 60)
    }

    /**
     * Comprobante bajo la duración: "Registrada 08:02" cuando el servidor ya
     * confirmó el inicio, o "Sin confirmar" mientras el aviso sigue en cola.
     * Es lo que el colaborador puede mostrar si dice que sí inició.
     */
    private fun refreshJourneyReceipt() {
        val label = findViewById<TextView>(R.id.duration_label) ?: return
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val journeyId = prefs.getLong(DmujeresApi.KEY_JOURNEY_ID, 0L)
        if (!DmujeresApi.isJourneyOpen(this) || journeyId <= 0L) {
            label.text = getString(R.string.duration_label)
            return
        }
        val confirmedAt = prefs.getLong(DmujeresApi.KEY_JOURNEY_CONFIRMED_AT, 0L)
        label.text = if (prefs.getLong(DmujeresApi.KEY_JOURNEY_CONFIRMED_ID, 0L) == journeyId && confirmedAt > 0L) {
            getString(
                R.string.journey_receipt_ok_fmt,
                java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date(confirmedAt)),
            )
        } else {
            getString(R.string.journey_receipt_pending)
        }
    }

    /**
     * ¿La app puede enviar ahora? Se mira el resultado de los últimos envíos y
     * la cola pendiente, no lo que dice el sistema, porque en algunos
     * teléfonos y con VPN eso no es confiable.
     */
    private var refreshing = false

    // Último resultado del botón Actualizar y cuándo terminó (pausa entre toques).
    private var ultimoResumen: String? = null
    private var ultimoRefresco = 0L

    // Ajuste que abre el próximo toque cuando el resultado es algo que la
    // persona puede arreglar.
    @Volatile
    private var accionPendiente: (() -> Unit)? = null

    // Fin de jornada pedido con un toque: se confirma con otro antes de esta hora.
    private var finArmadoHasta = 0L

    private fun finArmado(): Boolean = SystemClock.elapsedRealtime() < finArmadoHasta

    private fun minutoDelDia(): Int =
        java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("America/Guayaquil"))
            .let { it.get(java.util.Calendar.HOUR_OF_DAY) * 60 + it.get(java.util.Calendar.MINUTE) }

    /** Recuadro del motivo para finalizar en horario laboral, en la misma pantalla. */
    private fun iniciarJornada(nota: String?) {
        ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
        DmujeresApi.journeyStarted(this, "manual", nota)
        refreshLockedHome()
    }

    // El mismo recuadro pide el motivo para finalizar en horario laboral o
    // para iniciar tarde; cambian los textos y el botón.
    private var notaParaInicio = false

    private fun mostrarNota(visible: Boolean, inicio: Boolean) {
        notaParaInicio = inicio
        val panel = findViewById<View>(R.id.fin_nota_panel)
        val campo = findViewById<EditText>(R.id.fin_nota_campo)
        if (visible) {
            val desde = Ajustes.valor(Ajustes.Clave.INICIO_CON_MOTIVO_DESDE_MIN).toInt()
            findViewById<TextView>(R.id.fin_nota_titulo_texto).setText(if (inicio) R.string.inicio_nota_titulo else R.string.fin_nota_titulo)
            findViewById<TextView>(R.id.fin_nota_ayuda_texto).text = if (inicio) {
                getString(R.string.inicio_nota_ayuda, "%02d:%02d".format(desde / 60, desde % 60))
            } else {
                getString(R.string.fin_nota_ayuda)
            }
            campo.setHint(if (inicio) R.string.inicio_nota_hint else R.string.fin_nota_hint)
            findViewById<TextView>(R.id.fin_nota_error).setText(if (inicio) R.string.inicio_nota_falta else R.string.fin_nota_falta)
            findViewById<TextView>(R.id.fin_nota_finalizar).setText(if (inicio) R.string.journey_start_upper else R.string.journey_stop_upper)
        }
        findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.fluido(it) }
        panel.visibility = if (visible) View.VISIBLE else View.GONE
        // El recuadro trae su propio "Finalizar jornada": el de arriba se oculta para no repetirlo.
        findViewById<View>(R.id.journey_button).visibility = if (visible) View.GONE else View.VISIBLE
        findViewById<View>(R.id.fin_nota_error).visibility = View.GONE
        val teclado = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        if (visible) {
            campo.requestFocus()
            campo.post { teclado.showSoftInput(campo, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT) }
        } else {
            campo.text.clear()
            teclado.hideSoftInputFromWindow(campo.windowToken, 0)
            campo.clearFocus()
        }
    }

    // Cuenta atrás dentro del botón ACTUALIZAR cuando se toca antes de tiempo:
    // así se ve que el toque se recibió y cuándo vuelve a estar disponible.
    private var enEspera = false
    private val tickEspera = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            val button = findViewById<Button>(R.id.update_button) ?: return
            val faltan = (PAUSA_REFRESCO_MS - (SystemClock.elapsedRealtime() - ultimoRefresco) + 999) / 1000
            if (faltan <= 0 || refreshing) {
                enEspera = false
                if (!refreshing) {
                    button.text = getString(R.string.refresh_button)
                    button.setTextColor(updateButtonIdleColor())
                }
                return
            }
            button.text = getString(R.string.refresh_cooldown_fmt, faltan.toInt())
            button.setTextColor(getColor(R.color.text_secondary))
            uiHandler.postDelayed(this, 1_000)
        }
    }

    private fun mostrarEspera() {
        if (enEspera) return
        enEspera = true
        tickEspera.run()
    }

    /**
     * "¿Cómo usar?": al entrar en la app el texto se despliega de izquierda a
     * derecha y después se recoge; queda el signo, que abre la guía.
     */
    private fun presentarAyuda(animar: Boolean) {
        val boton = findViewById<View>(R.id.ayuda_boton) ?: return
        val texto = findViewById<TextView>(R.id.ayuda_texto) ?: return
        boton.setOnClickListener { startActivity(Intent(this, AyudaActivity::class.java)) }
        if (!animar) return
        texto.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        val ancho = texto.measuredWidth
        fun anchoA(desde: Int, hasta: Int, ms: Long, alTerminar: () -> Unit) {
            android.animation.ValueAnimator.ofInt(desde, hasta).apply {
                duration = ms
                interpolator = android.view.animation.DecelerateInterpolator()
                addUpdateListener { texto.layoutParams = texto.layoutParams.apply { width = it.animatedValue as Int } }
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) = alTerminar()
                })
                start()
            }
        }
        texto.layoutParams = texto.layoutParams.apply { width = 0 }
        texto.visibility = View.VISIBLE
        uiHandler.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            anchoA(0, ancho, 450) {
                uiHandler.postDelayed({
                    if (!isFinishing && !isDestroyed) anchoA(ancho, 0, 350) { texto.visibility = View.GONE }
                }, 6_000)
            }
        }, 600)
    }

    /** Color de reposo del botón ACTUALIZAR: navy con jornada, gris sin ella. */
    private fun updateButtonIdleColor(): Int = androidx.core.content.ContextCompat.getColor(
        this,
        if (DmujeresApi.isJourneyOpen(this)) R.color.navy else R.color.muted,
    )

    /**
     * Refresco manual con el avance dentro del botón: el texto de cada paso
     * reemplaza la palabra ACTUALIZAR y el relleno azul avanza de izquierda a
     * derecha según los pasos hechos, de forma continua.
     */
    private fun runProgressiveRefresh() {
        if (refreshing) return
        refreshing = true
        uiHandler.removeCallbacks(tickEspera)
        enEspera = false
        val button = findViewById<Button>(R.id.update_button)
        val fill = (button.background as android.graphics.drawable.LayerDrawable)
            .findDrawableByLayerId(R.id.progress_fill) as android.graphics.drawable.ClipDrawable
        var fillAnimator: android.animation.ValueAnimator? = null
        val navy = androidx.core.content.ContextCompat.getColor(this, R.color.navy)

        // Color del relleno: azul normal y naranja si falla un paso
        // importante. Al reintentar vuelve a azul.
        var fillTint = navy
        var warningShown = false
        fun animateFillTint(to: Int, durationMs: Long) {
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                android.animation.ValueAnimator.ofArgb(fillTint, to).apply {
                    duration = durationMs
                    addUpdateListener { value ->
                        fillTint = value.animatedValue as Int
                        fill.setTint(fillTint)
                    }
                    start()
                }
            }
        }
        fun markWarning() {
            if (warningShown) return
            warningShown = true
            animateFillTint(REFRESH_WARNING_COLOR, 700)
        }
        // El relleno nuevo empieza en azul aunque el anterior terminara naranja.
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                fillTint = navy
                fill.setTint(navy)
            }
        }

        fun fillTo(step: Int, durationMs: Long) {
            fillAnimator?.cancel()
            val target = step * 10_000 / REFRESH_STEPS
            fillAnimator = android.animation.ValueAnimator.ofInt(fill.level, target).apply {
                duration = durationMs
                interpolator = android.view.animation.LinearInterpolator()
                addUpdateListener { value ->
                    fill.level = value.animatedValue as Int
                    // La letra pasa a blanco a medida que el relleno la cubre.
                    val fraction = (value.animatedValue as Int) / 10_000f
                    button.setTextColor(
                        android.animation.ArgbEvaluator().evaluate(
                            fraction, navy, android.graphics.Color.WHITE,
                        ) as Int,
                    )
                }
                start()
            }
        }
        fun say(text: String, step: Int, durationMs: Long = 1_100) {
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                // Cada paso y el resultado se leen dentro del mismo botón.
                button.text = text
                fillTo(step, durationMs)
            }
        }
        Thread {
            try {
                // 1) Sube lo pendiente: puntos, avisos de jornada y actividades,
                // y manda el diagnóstico para que el panel vea el teléfono ya.
                val before = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(0)
                say(getString(R.string.refresh_step_sending), 1)
                TrackingService.refreshNow()
                DmujeresApi.flushJourneyEvents(this)
                com.dmujeres.app.cronograma.Actividades.sincronizar(this)
                ServiceHeartbeat.reportNow()
                // Se espera a que la cola baje de verdad (hasta 6 s), no un tiempo fijo.
                var after = before
                var quieto = 0
                for (i in 0 until 12) {
                    if (after == 0) break
                    runCatching { Thread.sleep(500) }
                    val ahora = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(after)
                    quieto = if (ahora == after) quieto + 1 else 0
                    after = ahora
                    if (quieto >= 3) break
                }
                // 2) Lo que la persona puede arreglar, y qué tiene el servidor.
                say(getString(R.string.refresh_step_checking), 2)
                val gpsOn = runCatching {
                    (getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager)
                        .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                }.getOrDefault(false)
                val online = runCatching {
                    NetworkManager(this, object : NetworkManager.NetworkHandler {
                        override fun onNetworkUpdate(isOnline: Boolean) = Unit
                    }).isOnline
                }.getOrDefault(false)
                val batterySaver = runCatching {
                    !(getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager)
                        .isIgnoringBatteryOptimizations(packageName)
                }.getOrDefault(false)
                val serverOk = online && DmujeresApi.serverReachable(this)
                val ultimoPunto = if (serverOk) DmujeresApi.fetchUltimoPunto(this) else null
                // La configuración del servidor se revisa sin mostrarla.
                if (serverOk && requestRemoteConfig() == ConfigState.UPDATED) {
                    stopService(Intent(this, TrackingService::class.java))
                    ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
                }
                val journeyOpen = DmujeresApi.isJourneyOpen(this)
                val summary = RefreshOutcome(
                    journeyOpen = journeyOpen,
                    pendingBefore = before,
                    pendingAfter = after,
                    gpsOn = gpsOn,
                    online = online,
                    serverOk = serverOk,
                    batterySaver = batterySaver,
                ).summary()
                val texto = when {
                    summary == RefreshSummary.ALL_GOOD && ultimoPunto != null -> getString(
                        R.string.refresh_summary_ok_fmt,
                        java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date(ultimoPunto)),
                    )
                    else -> getString(summary.textRes)
                }
                // Si se puede arreglar desde el teléfono, el siguiente toque lleva
                // directo al ajuste.
                accionPendiente = when (summary) {
                    RefreshSummary.GPS_OFF -> {
                        { startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
                    }
                    RefreshSummary.BATTERY_SAVER -> {
                        { OnboardingActivity.start(this, OnboardingActivity.STEP_PERMISSIONS) }
                    }
                    else -> null
                }
                if (summary.allGood) animateFillTint(navy, 400) else markWarning()
                say(texto, REFRESH_STEPS, 700)
                ultimoResumen = texto
                runOnUiThread {
                    runCatching { refreshLockedHome() }
                    // De paso se revisa si hay versión nueva de la app.
                    runCatching { showUpdateDialogIfAvailable() }
                }
                // Si algo falló, el mensaje queda el tiempo suficiente para leerlo y tocarlo.
                runCatching { Thread.sleep(if (summary.allGood) 2_500 else 6_000) }
                accionPendiente = null
                // Reposo: vuelve la palabra ACTUALIZAR y el fondo blanco.
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    fillAnimator?.cancel()
                    button.text = getString(R.string.refresh_button)
                    button.setTextColor(updateButtonIdleColor())
                    android.animation.ValueAnimator.ofInt(10_000, 0).apply {
                        duration = 350
                        addUpdateListener { value -> fill.level = value.animatedValue as Int }
                        start()
                    }
                }
            } finally {
                ultimoRefresco = SystemClock.elapsedRealtime()
                refreshing = false
            }
        }.start()
    }

    // Con GPS continuo casi siempre hay 1-3 puntos esperando su lote: exigir 0
    // hacía parpadear "Sin conexión" con la red perfecta. Cuenta la falla real
    // de envío o una cola que ya se acumula.
    /**
     * Tras un 401 con token, cuando la cola ya subió lo pendiente, lleva a
     * entrar de nuevo. Se revisa al volver y mientras la pantalla está abierta.
     */
    private fun maybeAskLogin() {
        if (isFinishing || isDestroyed) return
        if (!SessionStore.hasSession(this)) {
            recuperarSesion()
            return
        }
        if (!SessionStore.takeIrALogin(this)) return
        LoginActivity.start(this)
    }

    /**
     * Sin sesión, primero se pide al servidor la de esta instalación; solo si
     * no la hay se lleva a entrar con usuario y clave. Sin red se reintenta
     * cada 30 s.
     */
    private fun recuperarSesion() {
        val ahora = SystemClock.elapsedRealtime()
        if (recuperando || (ultimaRecuperacion > 0L && ahora - ultimaRecuperacion < 30_000L)) return
        recuperando = true
        ultimaRecuperacion = ahora
        Thread {
            val resultado = DmujeresApi.recuperarSesion(applicationContext)
            runOnUiThread {
                recuperando = false
                if (isFinishing || isDestroyed) return@runOnUiThread
                when (resultado) {
                    DmujeresApi.Recuperacion.OK -> {
                        LoginActivity.tomarSesionNueva(this)
                        runCatching { refreshLockedHome() }
                    }
                    DmujeresApi.Recuperacion.NO_HAY -> {
                        SessionStore.takeIrALogin(this)
                        LoginActivity.start(this)
                    }
                    DmujeresApi.Recuperacion.SIN_RED -> Unit
                }
            }
        }.start()
    }

    private var recuperando = false
    private var ultimaRecuperacion = 0L

    /** Espera la configuración del servidor, con tope. NA = no se llegó a consultar. */
    private fun requestRemoteConfig(): ConfigState {
        val latch = java.util.concurrent.CountDownLatch(1)
        val changed = java.util.concurrent.atomic.AtomicBoolean(false)
        RemoteConfig.refresh(this) {
            changed.set(it)
            latch.countDown()
        }
        // La consulta corta a los 5 s; el tope evita quedarse esperando si la
        // respuesta nunca llega.
        val answered = runCatching {
            latch.await(8, java.util.concurrent.TimeUnit.SECONDS)
        }.getOrDefault(false)
        return when {
            !answered -> ConfigState.NA
            changed.get() -> ConfigState.UPDATED
            else -> ConfigState.OK
        }
    }

    /** Un aviso que se muestra en rojo mientras falta; en verde cuando se arregla. */
    private class Aviso(val rojo: Int, val verde: Int, val accion: () -> Unit)

    private var avisoMostrado: Aviso? = null
    private var verdeHasta = 0L

    private fun avisosPendientes(): List<Aviso> {
        val ctx = this
        return buildList {
            val gps = runCatching {
                (getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager)
                    .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
            }.getOrDefault(true)
            if (!gps) add(Aviso(R.string.location_warning_text, R.string.aviso_ok_gps) {
                startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            })
            if (!AjustesPermisos.ubicacion(ctx)) add(Aviso(R.string.permission_warning_location, R.string.aviso_ok_ubicacion) {
                androidx.core.app.ActivityCompat.requestPermissions(
                    ctx,
                    arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                    REQUEST_PERMISO_UBICACION,
                )
            })
            if (!AjustesPermisos.ubicacionSiempre(ctx)) add(Aviso(R.string.permission_warning_background, R.string.aviso_ok_todo_el_tiempo) {
                AjustesPermisos.abrirUbicacion(ctx)
            })
            // Con la batería restringida el sistema duerme la app y la ruta sale con cortes.
            val optimizada = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && runCatching {
                !(getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager)
                    .isIgnoringBatteryOptimizations(packageName)
            }.getOrDefault(false)
            val restringida = optimizada || AjustesPermisos.segundoPlanoRestringido(ctx)
            if (restringida) add(Aviso(R.string.aviso_bateria_restringida, R.string.aviso_ok_bateria_restringida) {
                // Ya sin optimización pero en "Restringida": se cambia en la ficha.
                val intento = if (optimizada) {
                    Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:$packageName"))
                } else {
                    Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))
                }
                runCatching { startActivity(intento) }.onFailure {
                    runCatching { startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                }
            })
            if (!AjustesPermisos.notificaciones(ctx)) add(Aviso(R.string.permission_warning_notifications, R.string.aviso_ok_notificaciones) {
                AjustesPermisos.abrirNotificaciones(ctx)
            })
            if (!AjustesPermisos.actividadFisica(ctx)) add(Aviso(R.string.permission_warning_activity, R.string.aviso_ok_actividad) {
                androidx.core.app.ActivityCompat.requestPermissions(
                    ctx,
                    arrayOf(Manifest.permission.ACTIVITY_RECOGNITION),
                    REQUEST_PERMISO_ACTIVIDAD,
                )
            })
            if (EstadoTelefono.ahorroDeBateria(ctx)) add(Aviso(R.string.aviso_ahorro_bateria, R.string.aviso_ok_ahorro) {
                startActivity(Intent(android.provider.Settings.ACTION_BATTERY_SAVER_SETTINGS))
            })
            // Xiaomi deja leer estos dos ajustes: sin ellos la app no vuelve sola.
            if (OemAutostart.inicioAutomaticoXiaomi(ctx) == false) add(Aviso(R.string.aviso_inicio_automatico, R.string.aviso_ok_inicio_automatico) {
                OemAutostart.open(ctx)
            })
            if (OemAutostart.sinRestriccionXiaomi(ctx) == false) add(Aviso(R.string.aviso_xiaomi_ahorro, R.string.aviso_ok_xiaomi_ahorro) {
                OemAutostart.abrirAhorroXiaomi(ctx)
            })
            // En las demás marcas el ajuste no se puede leer: se pide cuando el
            // teléfono cerró la app y no la dejó volver (ver CierreDelSistema).
            val ajuste = ajusteDeCierre()
            val cierre = ajuste?.let { CierreDelSistema.pendiente(ctx) }
            if (ajuste != null && cierre != null) add(Aviso(ajuste.first, R.string.aviso_ok_cierre) {
                CierreDelSistema.atender(ctx, cierre)
                ajuste.second()
            })
        }
    }

    /** Texto y pantalla del ajuste que evita los cierres en cada marca; Xiaomi va arriba. */
    private fun ajusteDeCierre(): Pair<Int, () -> Unit>? {
        val ficha = {
            runCatching {
                startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
            }
            Unit
        }
        return when (OemAutostart.marca()) {
            OemAutostart.Marca.HUAWEI, OemAutostart.Marca.HONOR ->
                R.string.aviso_cierre_inicio_apps to { OemAutostart.abrirInicioDeApps(this); Unit }
            OemAutostart.Marca.SAMSUNG ->
                R.string.aviso_cierre_nunca_suspender to { OemAutostart.abrirNuncaSuspender(this); Unit }
            OemAutostart.Marca.TRANSSION ->
                R.string.aviso_cierre_inicio_automatico to { if (!OemAutostart.open(this)) ficha() }
            OemAutostart.Marca.OTRA -> R.string.aviso_cierre_bateria to ficha
            OemAutostart.Marca.XIAOMI -> null
        }
    }

    /**
     * Revisa los avisos: el primero pendiente sale en rojo al momento; cuando
     * se arregla, sale en verde unos segundos.
     */
    private fun revisarAvisos() {
        val banner = findViewById<LinearLayout>(R.id.permission_warning) ?: return
        val text = findViewById<TextView>(R.id.permission_warning_text) ?: return
        val pendiente = avisosPendientes().firstOrNull()
        val ahora = SystemClock.elapsedRealtime()
        when {
            pendiente != null -> {
                avisoMostrado = pendiente
                verdeHasta = 0L
                pintarAviso(banner, text, getString(pendiente.rojo), verde = false) { pendiente.accion() }
            }
            avisoMostrado != null -> {
                pintarAviso(banner, text, getString(avisoMostrado!!.verde), verde = true, accion = null)
                avisoMostrado = null
                verdeHasta = ahora + DURACION_AVISO_VERDE_MS
            }
            ahora >= verdeHasta && banner.visibility != View.GONE -> {
                findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.suave(it) }
                banner.visibility = View.GONE
                compactar(false)
            }
        }
    }

    private fun pintarAviso(banner: LinearLayout, text: TextView, mensaje: String, verde: Boolean, accion: (() -> Unit)?) {
        // Aparece o cambia de rojo a verde con transición; los refrescos iguales no la repiten.
        if (banner.visibility != View.VISIBLE || text.text.toString() != mensaje) {
            findViewById<ViewGroup>(R.id.cuerpo)?.let { Animaciones.suave(it) }
        }
        text.text = mensaje
        text.setTextColor(getColor(if (verde) R.color.ok else R.color.primary_dark))
        // Arreglado: solo el texto en verde, sin ícono.
        findViewById<TextView>(R.id.permission_warning_icono)?.apply {
            visibility = if (verde) View.GONE else View.VISIBLE
            this.text = "!"
            setBackgroundResource(R.drawable.ds_circulo_rojo)
        }
        Animaciones.fondo(banner, if (verde) R.drawable.ds_ok_aviso else R.drawable.ds_aviso_rojo)
        banner.setOnClickListener(accion?.let { a -> View.OnClickListener { a() } })
        banner.visibility = View.VISIBLE
        compactar(true)
    }

    /**
     * Con un aviso a la vista la pantalla se compacta (menos aire, el tiempo
     * un poco más chico) para que todo siga cabiendo sin desplazar: si no,
     * el logo quedaba cortado arriba. Sin aviso vuelve a su tamaño.
     */
    private fun compactar(compacta: Boolean) {
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        findViewById<View>(R.id.logo_inicio)?.let { logo ->
            (logo.layoutParams as? ViewGroup.MarginLayoutParams)?.let {
                it.topMargin = dp(if (compacta) 0 else 2)
                it.bottomMargin = dp(if (compacta) 2 else 8)
                logo.layoutParams = it
            }
        }
        findViewById<View>(R.id.tarjeta_jornada)?.let {
            val p = dp(if (compacta) 10 else 12)
            it.setPadding(p, if (compacta) dp(8) else p, p, p)
        }
        findViewById<TextView>(R.id.duration_value)?.textSize = if (compacta) 23f else 27f
        findViewById<View>(R.id.permission_warning)?.let {
            it.minimumHeight = dp(if (compacta) 44 else 52)
            it.setPadding(dp(12), dp(if (compacta) 7 else 10), dp(12), dp(if (compacta) 7 else 10))
        }
        findViewById<TextView>(R.id.permission_warning_text)?.textSize = if (compacta) 13f else 14f
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshLockedHome()
    }

    /** Permisos mínimos para iniciar jornada (los mismos del asistente). */
    private fun journeyPermissionsGranted(): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun readBattery(): Pair<Int, Boolean> {
        val intent = registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
        if (intent == null) return -1 to false
        val level = intent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 1)
        val status = intent.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1)
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        return pct to (status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
            status == android.os.BatteryManager.BATTERY_STATUS_FULL)
    }

    private fun onVersionTap() {
        val now = SystemClock.elapsedRealtime()
        val valid = tapCount > 0 && now - tapLastAt in 1..1_200L && now - tapFirstAt <= 4_000L
        tapCount = if (valid) tapCount + 1 else 1
        if (!valid) tapFirstAt = now
        tapLastAt = now
        if (tapCount >= 5) {
            tapCount = 0
            // Acceso oculto: menú de depuración (pantallas y backend).
            startActivity(Intent(this, DebugActivity::class.java))
        }
    }

}

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
package com.dmujeres.app

import androidx.appcompat.app.AppCompatActivity
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.TextView
import android.widget.LinearLayout
import android.widget.Button
import android.widget.ImageView
import android.widget.Toast
import android.view.View
import android.os.SystemClock
import androidx.appcompat.app.AlertDialog
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager

/** Refresco en vivo del home (estado, pendientes, batería y duración). */
private const val LIVE_REFRESH_MS = 5_000L

/** Extra del menú de depuración para probar la animación del banner. */
const val EXTRA_BANNER_DEMO = "bannerDemo"

/** Marca del último chequeo de actualización (para el freno). */
private const val KEY_LAST_OTA_CHECK = "lastOtaCheckApp"

/** Pasos visibles del refresco manual (para el relleno proporcional). */
private const val REFRESH_STEPS = 8

/** Bloqueo del botón de jornada tras un toque (anti doble toque). */
private const val JOURNEY_TAP_GUARD_MS = 1_200L

/** Pendientes a partir de los cuales el estado pasa a "Sin conexión". */
private const val PENDING_OFFLINE_THRESHOLD = 30

/** Aviso "inicia la jornada" en el botón ACTUALIZAR (luego vuelve solo). */
private const val JOURNEY_NOTICE_MS = 2_500L

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
     * sale siempre que la versión publicada sea mayor que la instalada.
     */
    private fun maybeCheckOta(force: Boolean = false) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_OTA_CHECK, 0L)
        if (!force && !OtaPolicy.shouldCheck(now, last, coldStart = false)) return
        showUpdateDialogIfAvailable {
            prefs.edit().putLong(KEY_LAST_OTA_CHECK, System.currentTimeMillis()).apply()
        }
    }

    /**
     * Banner superior de actualización: pegado al borde de arriba, baja
     * deslizándose y empuja el home; al tocarlo descarga e instala. Se revisa
     * en vivo (al abrir, al volver y cada minuto con la app abierta).
     */
    private fun showUpdateDialogIfAvailable(onDone: (() -> Unit)? = null) {
        DmujeresApi.checkOta(this) { label, url, sha256 ->
            runOnUiThread {
                onDone?.invoke()
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (label == null) return@runOnUiThread
                showUpdateBanner(url, sha256, version = label)
            }
        }
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
        // La hamburguesa acompaña la bajada para quedar visible debajo.
        console?.animate()?.translationY(height.toFloat())?.setDuration(420)?.setInterpolator(slide)?.start()
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
    }

    /** Menú de depuración: muestra la animación del banner sin tocar la OTA. */
    private fun showBannerDemo() {
        val banner = findViewById<LinearLayout>(R.id.update_banner)
        if (banner?.visibility == View.VISIBLE) {
            // Reinicia para poder repetir la animación las veces que haga falta.
            banner.visibility = View.GONE
            banner.translationY = 0f
            findViewById<android.widget.ImageButton>(R.id.console_button)?.translationY = 0f
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
        // Cronograma de actividades.
        findViewById<View>(R.id.cronograma_card).setOnClickListener {
            startActivity(Intent(this, com.dmujeres.app.cronograma.CronogramaActivity::class.java))
        }

        button.setOnClickListener {
            // Anti doble toque: el botón se bloquea un instante mientras cambia
            // de estado (dos toques rápidos abrían y cerraban la jornada).
            if (SystemClock.elapsedRealtime() - lastJourneyTapAt < JOURNEY_TAP_GUARD_MS) return@setOnClickListener
            lastJourneyTapAt = SystemClock.elapsedRealtime()
            if (DmujeresApi.isJourneyOpen(this)) {
                val startedAt = PreferenceManager.getDefaultSharedPreferences(this)
                    .getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L)
                val minutes = if (startedAt > 0L) ((System.currentTimeMillis() - startedAt) / 60_000L).toInt() else 0
                AlertDialog.Builder(this)
                    .setTitle(R.string.journey_confirm_title)
                    .setMessage(getString(R.string.journey_confirm_body, minutes / 60, minutes % 60))
                    .setPositiveButton(R.string.journey_confirm_ok) { _, _ ->
                        DmujeresApi.journeyEnded(this)
                        refreshLockedHome()
                    }
                    .setNegativeButton(R.string.journey_confirm_cancel, null)
                    .show()
            } else {
                // Sin los permisos que mantienen la captura y las notificaciones
                // la jornada no arranca: se avisa y se abre el paso de permisos.
                if (!journeyPermissionsGranted()) {
                    Toast.makeText(this, R.string.journey_missing_permissions, Toast.LENGTH_LONG).show()
                    OnboardingActivity.start(this, OnboardingActivity.STEP_PERMISSIONS)
                    return@setOnClickListener
                }
                ContextCompat.startForegroundService(
                    this, Intent(this, TrackingService::class.java),
                )
                DmujeresApi.journeyStarted(this)
                refreshLockedHome()
            }
        }
        // ACTUALIZAR: reenvía lo pendiente, pide una ubicación nueva y revisa
        // el servicio. El avance se ve dentro del botón: el texto cambia con
        // cada paso y el relleno avanza de izquierda a derecha. La
        // actualización de la app es el aviso de arriba.
        updateButton.setOnClickListener {
            // Sin jornada abierta no se refresca: el botón lo explica y vuelve.
            if (DmujeresApi.isJourneyOpen(this)) {
                runProgressiveRefresh()
            } else {
                showJourneyClosedNotice()
            }
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
            }
        }
        refreshLockedHome()
        // El reloj lo arranca onResume, que siempre corre después de onCreate.
    }


    /** Banner de estado (3 colores), cuadros y botón con el estado real. */
    private val uiHandler = android.os.Handler(android.os.Looper.getMainLooper())

    /** Último estado de la pill (para no re-animar en cada refresco). */
    private var pillStateRes = 0

    /** Cambia el estado de la pill con una transición suave de color. */
    private fun applyPillState(pill: LinearLayout, text: TextView, bgRes: Int, label: String, textColorRes: Int) {
        if (pillStateRes != bgRes) {
            val newBg = androidx.core.content.ContextCompat.getDrawable(this, bgRes)
            val oldBg = (pill.background as? android.graphics.drawable.DrawableWrapper)?.drawable
                ?: pill.background
            if (oldBg != null && newBg != null) {
                val transition = android.graphics.drawable.TransitionDrawable(arrayOf(oldBg, newBg))
                transition.isCrossFadeEnabled = true
                pill.background = transition
                transition.startTransition(400)
            } else {
                pill.setBackgroundResource(bgRes)
            }
            pillStateRes = bgRes
        }
        text.text = label
        text.setTextColor(getColor(textColorRes))
    }

    override fun onResume() {
        super.onResume()
        // Refresco inmediato + vivo cada 5 s mientras la pantalla esté abierta.
        runCatching { refreshLockedHome() }
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
        // Si el servidor cerró la sesión, se pide entrar de nuevo (una sola
        // vez y sin bloquear). Mientras tanto la app sigue registrando y
        // enviando con la clave compartida.
        maybeAskLogin()
    }

    override fun onPause() {
        super.onPause()
        // En segundo plano no se refresca (ahorra batería); al volver, sigue.
        durationTicker?.let { uiHandler.removeCallbacks(it) }
    }

    private fun refreshLockedHome() {
        if (isFinishing || isDestroyed) return
        val open = DmujeresApi.isJourneyOpen(this)
        val running = TrackingService.isRunning
        // Si la ubicación del sistema está apagada no hay ruta: se avisa en la
        // píldora y con una fila que abre los ajustes.
        val locationOn = runCatching {
            (getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager)
                .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        }.getOrDefault(true)
        findViewById<LinearLayout>(R.id.location_warning)?.visibility =
            if (locationOn) View.GONE else View.VISIBLE
        findViewById<LinearLayout>(R.id.location_warning)?.setOnClickListener {
            startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
        val pill = findViewById<LinearLayout>(R.id.status_pill)
        val pillText = findViewById<TextView>(R.id.pill_text)
        val button = findViewById<Button>(R.id.journey_button)
        val updateButton = findViewById<Button>(R.id.update_button)

        // Estados que se ven en el teléfono: EN LÍNEA (verde), SIN CONEXIÓN
        // (naranja), DESHABILITADO (gris, sin jornada) y UBICACIÓN APAGADA
        // (rojo, tiene prioridad). "Detenido" solo se muestra en el panel.
        val target = when {
            !locationOn -> Triple(R.drawable.bg_pill_red, getString(R.string.pill_location_off), R.color.white)
            !open -> Triple(R.drawable.bg_pill_gray, getString(R.string.pill_disabled), R.color.white)
            !canSend() -> Triple(R.drawable.bg_pill_orange, getString(R.string.pill_no_connection), R.color.white)
            else -> Triple(R.drawable.bg_pill_green, getString(R.string.pill_online), R.color.white)
        }
        applyPillState(pill, pillText, target.first, target.second, target.third)
        button.setBackgroundResource(
            if (open) R.drawable.bg_button_primary else R.drawable.bg_button_green,
        )
        button.text = getString(
            if (open) R.string.journey_stop_upper else R.string.journey_start_upper,
        )
        // ACTUALIZAR se ve apagado (texto gris) sin jornada abierta; un refresco
        // o el aviso en curso mandan sobre este estado de reposo.
        if (!refreshing && !journeyNotice) {
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
                // Guardamos el valor para que canSend() sepa si queda algo por enviar.
                cachedPending = pending
                findViewById<TextView>(R.id.pending_value)?.text = pending.toString()
            }
        }.start()
        refreshDuration()
        refreshCronograma()
    }

    /**
     * Tablet: el contenido se centra con un ancho máximo (una columna en
     * vertical, dos en horizontal). El pie azul sigue a todo el ancho y el
     * aviso flotante se alinea con él.
     */
    private fun adaptarATablet() {
        if (!Responsivo.esTablet(this)) return
        val horizontal = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        val ancho = if (horizontal) Responsivo.ANCHO_DOS_COLUMNAS_DP else Responsivo.ANCHO_COLUMNA_DP
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

    private fun refreshCronograma() {
        val resumen = findViewById<TextView>(R.id.crono_resumen) ?: return
        val detalle = findViewById<TextView>(R.id.crono_detalle)
        val accion = findViewById<TextView>(R.id.crono_accion)
        val zona = java.util.TimeZone.getTimeZone("America/Guayaquil")
        val ahora = java.util.Calendar.getInstance(zona)
        val hoy = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }.format(ahora.time)
        val horaActual = String.format(java.util.Locale.US, "%02d:%02d", ahora.get(java.util.Calendar.HOUR_OF_DAY), ahora.get(java.util.Calendar.MINUTE))
        val actividades = com.dmujeres.app.cronograma.Actividades
        val delDia = actividades.delDia(this, hoy)
        val hc = com.dmujeres.app.cronograma.HoraCronograma
        val enCurso = hc.enCurso(delDia, horaActual, { it.hora }, { it.horaFin })
        val siguiente = hc.siguiente(delDia, horaActual) { it.hora }
        // Solo una actividad iniciada sin hora de fin se finaliza desde aquí; al
        // finalizarla recibe su hora de fin y deja de estar abierta.
        val abierta = enCurso?.takeIf { it.horaFin == null && it.hora <= horaActual }
        fun nombre(a: com.dmujeres.app.cronograma.Actividad) =
            a.tipo.etiqueta + (a.lugar?.let { " · $it" } ?: "")
        resumen.text = if (enCurso != null) nombre(enCurso) else getString(R.string.crono_home_ninguna)
        detalle.text = when {
            abierta != null -> getString(
                R.string.crono_home_abierta_fmt,
                hc.legible(abierta.hora),
                hc.duracion(hc.aMinutos(horaActual) - hc.aMinutos(abierta.hora)),
            )
            enCurso?.horaFin != null -> getString(R.string.crono_home_rango_fmt, hc.legible(enCurso.horaFin))
            siguiente != null -> getString(R.string.crono_home_sigue_fmt, hc.legible(siguiente.hora), nombre(siguiente))
            delDia.isEmpty() -> getString(R.string.crono_home_vacio)
            else -> getString(R.string.crono_home_terminado_fmt, delDia.size)
        }
        accion.setText(if (abierta != null) R.string.crono_finalizar else R.string.crono_iniciar)
        accion.setBackgroundResource(if (abierta != null) R.drawable.ds_button_primary else R.drawable.ds_boton_blanco)
        accion.setTextColor(getColor(if (abierta != null) R.color.white else R.color.navy))
        accion.setOnClickListener {
            if (abierta == null) {
                startActivity(Intent(this, com.dmujeres.app.cronograma.ActividadActivity::class.java))
                return@setOnClickListener
            }
            val fin = maxOf(horaActual, hc.sumar(abierta.hora, 1))
            actividades.guardar(this, abierta.copy(horaFin = fin))
            refreshCronograma()
        }
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

    private fun refreshLockedHomeDuration() = refreshDuration()

    /**
     * ¿La app puede enviar ahora? Se mira el resultado de los últimos envíos y
     * la cola pendiente, no lo que dice el sistema, porque en algunos
     * teléfonos y con VPN eso no es confiable.
     */
    private var refreshing = false

    /** Aviso "inicia la jornada" visible ahora en el botón ACTUALIZAR. */
    private var journeyNotice = false

    /** Color de reposo del botón ACTUALIZAR: navy con jornada, gris sin ella. */
    private fun updateButtonIdleColor(): Int = androidx.core.content.ContextCompat.getColor(
        this,
        if (DmujeresApi.isJourneyOpen(this)) R.color.navy else R.color.muted,
    )

    /**
     * Sin jornada no hay nada que refrescar: el botón muestra el aviso unos
     * 2,5 s y vuelve a "ACTUALIZAR".
     */
    private fun showJourneyClosedNotice() {
        if (journeyNotice || refreshing) return
        journeyNotice = true
        val button = findViewById<Button>(R.id.update_button)
        val fill = (button.background as android.graphics.drawable.LayerDrawable)
            .findDrawableByLayerId(R.id.progress_fill) as android.graphics.drawable.ClipDrawable
        fill.level = 0
        button.text = getString(R.string.refresh_summary_journey_closed)
        button.setTextColor(getColor(R.color.muted))
        uiHandler.postDelayed({
            journeyNotice = false
            if (isFinishing || isDestroyed) return@postDelayed
            button.text = getString(R.string.refresh_button)
            button.setTextColor(updateButtonIdleColor())
        }, JOURNEY_NOTICE_MS)
    }

    /**
     * Refresco manual con el avance dentro del botón: el texto de cada paso
     * reemplaza la palabra ACTUALIZAR y el relleno azul avanza de izquierda a
     * derecha según los pasos hechos, de forma continua.
     */
    private fun runProgressiveRefresh() {
        if (refreshing) return
        refreshing = true
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
                button.text = text
                fillTo(step, durationMs)
            }
        }
        Thread {
            fun pause() = runCatching { Thread.sleep(900) }
            try {
                // 1) puntos pendientes
                val before = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(0)
                say(getString(R.string.refresh_step_pending, before), 1)
                TrackingService.refreshNow()
                pause()
                val after = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(0)
                say(getString(R.string.refresh_step_pending_ok, (before - after).coerceAtLeast(0)), 2)
                if (after > 0) markWarning()
                pause()
                // 2) GPS
                say(getString(R.string.refresh_step_gps), 3)
                val gpsOn = runCatching {
                    (getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager)
                        .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                }.getOrDefault(false)
                val lastFixAt = PreferenceManager.getDefaultSharedPreferences(this)
                    .getLong(PositionProvider.KEY_LAST_FIX_AT, 0L)
                val fixAge = if (lastFixAt > 0) (System.currentTimeMillis() - lastFixAt) / 1000 else -1
                say(
                    if (gpsOn) {
                        if (fixAge in 0..3600) getString(R.string.refresh_step_gps_ok, fixAge)
                        else getString(R.string.refresh_step_gps_wait)
                    } else {
                        getString(R.string.refresh_step_gps_off)
                    },
                    3,
                )
                if (!gpsOn) markWarning()
                pause()
                // 3) datos móviles / red
                say(getString(R.string.refresh_step_net), 4)
                val online = runCatching {
                    NetworkManager(this, object : NetworkManager.NetworkHandler {
                        override fun onNetworkUpdate(isOnline: Boolean) = Unit
                    }).isOnline
                }.getOrDefault(false)
                say(getString(if (online) R.string.refresh_step_net_ok else R.string.refresh_step_net_off), 4)
                if (!online) markWarning()
                pause()
                // 4) servidor
                say(getString(R.string.refresh_step_server), 5)
                val serverOk = DmujeresApi.serverReachable(this)
                say(getString(if (serverOk) R.string.refresh_step_server_ok else R.string.refresh_step_server_off), 5)
                if (!serverOk) markWarning()
                pause()
                // 5) configuración remota
                say(getString(R.string.refresh_step_config), 6)
                val config = requestRemoteConfig()
                say(
                    getString(
                        if (config == ConfigState.UPDATED) R.string.refresh_step_config_updated
                        else R.string.refresh_step_config_ok,
                    ),
                    6,
                )
                if (config == ConfigState.UPDATED) {
                    // Mismo reinicio que RemoteConfig.applyAndRestartIfChanged.
                    stopService(Intent(this, TrackingService::class.java))
                    ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
                }
                pause()
                // 6) Firebase
                say(getString(R.string.refresh_step_firebase), 7)
                val firebase = when (FcmStatus.hasToken(this)) {
                    true -> FirebaseState.OK
                    false -> FirebaseState.FAIL
                    else -> FirebaseState.NA
                }
                say(
                    getString(
                        when (firebase) {
                            FirebaseState.OK -> R.string.refresh_step_firebase_ok
                            FirebaseState.FAIL -> R.string.refresh_step_firebase_off
                            FirebaseState.NA -> R.string.refresh_step_firebase_na
                        },
                    ),
                    7,
                )
                pause()
                // Si algo falló de verdad, no se dice "Todo listo".
                val summary = RefreshOutcome(
                    journeyOpen = DmujeresApi.isJourneyOpen(this),
                    pendingBefore = before,
                    pendingAfter = after,
                    gpsOn = gpsOn,
                    online = online,
                    serverOk = serverOk,
                    firebase = firebase,
                    config = config,
                ).summary()
                // El color final del relleno sigue el resultado real: azul si
                // todo está bien, naranja de aviso si algo falló.
                if (summary.allGood) animateFillTint(navy, 400) else markWarning()
                say(getString(summary.textRes), 8, 700)
                runOnUiThread { runCatching { refreshLockedHome() } }
                pause()
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
                refreshing = false
            }
        }.start()
    }

    // Con GPS continuo casi siempre hay 1-3 puntos esperando su lote: exigir 0
    // hacía parpadear "Sin conexión" con la red perfecta. Cuenta la falla real
    // de envío o una cola que ya se acumula.
    private fun canSend(): Boolean =
        !ConnectionState.isFailing() && cachedPending < PENDING_OFFLINE_THRESHOLD

    /**
     * Aviso de sesión vencida (una vez): no bloquea y trae un botón para
     * volver a entrar. "Ahora no" lo cierra y la app sigue con la clave
     * compartida.
     */
    private fun maybeAskLogin() {
        if (isFinishing || isDestroyed) return
        if (!SessionStore.takeAuthFailed(this)) return
        AlertDialog.Builder(this)
            .setTitle(R.string.session_expired_title)
            .setMessage(R.string.session_expired_body)
            .setPositiveButton(R.string.session_expired_enter) { _, _ ->
                LoginActivity.start(this)
            }
            .setNegativeButton(R.string.session_expired_later, null)
            .show()
    }

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

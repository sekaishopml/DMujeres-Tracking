package com.dmujeres.app.pantallas

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.dmujeres.app.BuildConfig
import com.dmujeres.app.R
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.datos.RemoteConfig
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.seguimiento.TrackingService
import com.dmujeres.app.sistema.AjustesPermisos
import com.dmujeres.app.sistema.OemAutostart
import com.dmujeres.app.recuperacion.DozeAlarmReceiver

/**
 * Primer arranque: bienvenida, inicio de sesión y permisos.
 *
 * - La configuración viene del servidor: la persona no ve direcciones ni
 *   precisión.
 * - El menú de depuración se abre con 5 toques en la versión de la pantalla
 *   principal.
 * - Al terminar, el registro queda encendido y no hay botón para apagarlo.
 */
class OnboardingActivity : AppCompatActivity() {

    private lateinit var container: FrameLayout
    private lateinit var primary: Button
    private var step = STEP_WELCOME

    /** La transición de permisos se anima una sola vez por visita. */
    private var permissionsTransitionDone = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)
        Responsivo.raiz(this)?.let { Responsivo.centrarHijos(it) }

        container = findViewById(R.id.step_container)
        primary = findViewById(R.id.btn_primary)
        // La versión se muestra al pie de las tres pantallas.
        findViewById<TextView>(R.id.version_label).text =
            getString(R.string.version_format, BuildConfig.VERSION_NAME)

        primary.setOnClickListener {
            when (step) {
                STEP_WELCOME -> showLogin()
                STEP_LOGIN -> validateAndContinue()
                else -> when {
                    preview -> finish()
                    requiredGranted() -> finishOnboarding()
                    else -> requestMissing()
                }
            }
        }
        // El menú de depuración puede abrir directamente un paso del asistente
        // para revisar el diseño sin recorrerlo entero.
        // Al girar la tablet se vuelve al mismo paso.
        when (savedInstanceState?.getString(KEY_STEP) ?: intent.getStringExtra(EXTRA_STEP)) {
            STEP_LOGIN -> showLogin()
            STEP_PERMISSIONS -> showPermissions()
            else -> showWelcome()
        }
    }

    override fun onResume() {
        super.onResume()
        if (step == STEP_PERMISSIONS) showPermissions()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(KEY_STEP, step)
    }

    /**
     * Cierra el teclado al tocar fuera del campo.
     */
    override fun dispatchTouchEvent(event: android.view.MotionEvent): Boolean {
        val focus = currentFocus
        if (focus is EditText) {
            val rect = android.graphics.Rect()
            focus.getGlobalVisibleRect(rect)
            if (!rect.contains(event.x.toInt(), event.y.toInt())) {
                (getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .hideSoftInputFromWindow(focus.windowToken, 0)
                focus.clearFocus()
            }
        }
        return super.dispatchTouchEvent(event)
    }

    // ── Paso 1: bienvenida ──────────────────────────────────────────────────

    /** Avance del asistente: barras y rótulo "PASO N DE 3". */
    private fun markStep(number: Int, labelRes: Int) {
        listOf(R.id.step_bar_1, R.id.step_bar_2, R.id.step_bar_3).forEachIndexed { index, id ->
            findViewById<View>(id)?.setBackgroundResource(
                if (index < number) R.drawable.ds_step_on else R.drawable.ds_step_off,
            )
        }
        findViewById<TextView>(R.id.step_label)?.text =
            getString(R.string.onboarding_step_fmt, number, getString(labelRes))
    }

    private fun bindFeature(view: View, id: Int, number: Int, titleRes: Int, textRes: Int) {
        val row = view.findViewById<View>(id) ?: return
        row.findViewById<TextView>(R.id.feature_number)?.text = number.toString()
        row.findViewById<TextView>(R.id.feature_title)?.setText(titleRes)
        row.findViewById<TextView>(R.id.feature_text)?.setText(textRes)
    }

    private fun showWelcome() {
        step = STEP_WELCOME
        markStep(1, R.string.onboarding_step_welcome)
        container.removeAllViews()
        val view = LayoutInflater.from(this).inflate(R.layout.onboarding_step_welcome, container, false)
        container.addView(view)
        bindFeature(view, R.id.welcome_step1, 1, R.string.welcome_feature_login_title, R.string.welcome_feature_login_text)
        bindFeature(view, R.id.welcome_step2, 2, R.string.welcome_feature_perms_title, R.string.welcome_feature_perms_text)
        bindFeature(view, R.id.welcome_step3, 3, R.string.welcome_feature_ready_title, R.string.welcome_feature_ready_text)
        primary.text = getString(R.string.onboarding_continue)
        // Entrada escalonada: fade + desplazamiento corto + zoom mínimo (sin blur).
        listOf(
            R.id.welcome_header to 0L,
            R.id.welcome_step1 to 80L,
            R.id.welcome_step2 to 160L,
            R.id.welcome_step3 to 240L,
            R.id.welcome_footer to 320L,
        ).forEach { (id, delay) ->
            view.findViewById<View>(id)?.let { SoftEntrance.animate(it, delayMs = delay) }
        }
    }

    // ── Paso 2: login (cada quien escribe sus datos) ────────────────────────

    private fun showLogin() {
        step = STEP_LOGIN
        markStep(2, R.string.onboarding_step_login)
        container.removeAllViews()
        container.addView(LayoutInflater.from(this).inflate(R.layout.onboarding_step_login, container, false))
        primary.text = getString(R.string.login_button)
        // Transición suave al cambiar de paso.
        SoftEntrance.transition(container)
    }

    /**
     * Revisa el inicio de sesión y muestra el error debajo del título, sin
     * ventana emergente: campos vacíos, usuario o contraseña incorrectos, o
     * sin conexión. Usa POST /api/mobile/v1/sesion (o la clave compartida si
     * el servidor no tiene esa ruta) y guarda el token. Solo si sale bien se
     * pasa a los permisos.
     */
    private val preview: Boolean
        get() = intent.getBooleanExtra(EXTRA_PREVIEW, false)

    private fun validateAndContinue() {
        if (preview) {
            showPermissions()
            return
        }
        val view = container.getChildAt(0) ?: return
        val userField = view.findViewById<EditText>(R.id.field_user) ?: return
        val passField = view.findViewById<EditText>(R.id.field_pass) ?: return
        val error = view.findViewById<TextView>(R.id.login_error) ?: return

        fun showError(messageRes: Int) {
            error.setText(messageRes)
            error.visibility = View.VISIBLE
        }
        val userId = userField.text.toString().trim()
        if (userId.isEmpty()) {
            showError(R.string.login_error_user)
            return
        }
        val password = passField.text.toString().trim()
        if (password.isEmpty()) {
            showError(R.string.login_error_password)
            return
        }
        error.visibility = View.GONE
        primary.isEnabled = false
        primary.text = getString(R.string.login_checking)
        Thread {
            val result = DmujeresApi.login(this, userId, password)
            runOnUiThread {
                primary.isEnabled = true
                primary.text = getString(R.string.login_button)
                when (result) {
                    DmujeresApi.LoginResult.AUTHORIZED -> showPermissions()
                    DmujeresApi.LoginResult.UNKNOWN_USER -> showError(R.string.login_error_unknown)
                    DmujeresApi.LoginResult.BAD_CREDENTIALS -> showError(R.string.login_error_credentials)
                    DmujeresApi.LoginResult.LOCKED -> showError(R.string.login_error_locked)
                    DmujeresApi.LoginResult.OTHER_PHONE -> showError(R.string.login_error_other_phone)
                    else -> showError(R.string.login_error_offline)
                }
            }
        }.start()
    }

    // ── Paso 3: permisos y batería ──────────────────────────────────────────

    private fun showPermissions() {
        step = STEP_PERMISSIONS
        markStep(3, R.string.onboarding_step_perms)
        container.removeAllViews()
        val view = LayoutInflater.from(this).inflate(R.layout.onboarding_step_permissions, container, false)
        container.addView(view)
        val rows = view.findViewById<LinearLayout>(R.id.permissions_container)
        // La animación solo la primera vez; al volver de Ajustes no se repite.
        if (!permissionsTransitionDone) {
            permissionsTransitionDone = true
            SoftEntrance.transition(container)
        }

        var total = 0
        var done = 0
        fun row(icon: Int, title: Int, why: Int, granted: Boolean?, required: Boolean, actionLabel: Int, action: () -> Unit) {
            total += 1
            if (granted == true) done += 1
            addRow(rows, icon, title, why, granted, required, actionLabel, action)
        }
        row(R.drawable.ds_ic_location, R.string.perm_location, R.string.perm_location_why,
            isGranted(Manifest.permission.ACCESS_FINE_LOCATION), true, R.string.onboarding_perms_allow) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                REQUEST_LOCATION,
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            row(R.drawable.ds_ic_pin, R.string.perm_background, R.string.perm_background_why,
                isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION), true, R.string.onboarding_perms_allow) {
                // Sin ubicación precisa Android no ofrece "todo el tiempo".
                if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        REQUEST_LOCATION,
                    )
                } else {
                    requestBackground()
                }
            }
        }
        // En todas las versiones: antes de Android 13 no hay permiso que pedir,
        // pero la persona puede apagarlas en Ajustes y dejaría de ver los avisos.
        row(R.drawable.ds_ic_bell, R.string.perm_notifications, R.string.perm_notifications_why,
            notificacionesListas(), true, R.string.onboarding_perms_allow) { pedirNotificaciones() }
        // Pasos: comprueba que el teléfono va con la persona. No es obligatorio.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            row(R.drawable.ds_ic_pasos, R.string.perm_activity, R.string.perm_activity_why,
                isGranted(Manifest.permission.ACTIVITY_RECOGNITION), false, R.string.onboarding_perms_allow) {
                requestPermissions(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION), REQUEST_ACTIVITY)
            }
        }
        row(R.drawable.ds_ic_battery, R.string.perm_battery, R.string.perm_battery_why,
            bateriaLibre(), true, R.string.onboarding_perms_allow) { requestBattery() }
        // Android 12 deja quitar las alarmas exactas; sin ellas la supervisión
        // cada pocos minutos se vuelve irregular.
        if (!DozeAlarmReceiver.exactas(this)) {
            row(R.drawable.ds_ic_power, R.string.perm_alarmas, R.string.perm_alarmas_why,
                false, false, R.string.onboarding_perms_allow) { pedirAlarmas() }
        }
        // Ajustes del fabricante: casi ninguno se puede consultar, así que
        // quedan como recomendados (sin visto) con un botón a su pantalla.
        when (OemAutostart.marca()) {
            OemAutostart.Marca.XIAOMI -> {
                addRow(rows, R.drawable.ds_ic_power, R.string.perm_autostart, R.string.perm_autostart_why,
                    OemAutostart.inicioAutomaticoXiaomi(this), false, R.string.perm_autostart_open) { openAutostart() }
                addRow(rows, R.drawable.ds_ic_battery, R.string.perm_xiaomi_ahorro, R.string.perm_xiaomi_ahorro_why,
                    OemAutostart.sinRestriccionXiaomi(this), false, R.string.perm_autostart_open) {
                    OemAutostart.abrirAhorroXiaomi(this)
                }
            }
            OemAutostart.Marca.HUAWEI, OemAutostart.Marca.HONOR ->
                addRow(rows, R.drawable.ds_ic_power, R.string.perm_inicio_apps, R.string.perm_inicio_apps_why,
                    null, false, R.string.perm_autostart_open) { OemAutostart.abrirInicioDeApps(this) }
            OemAutostart.Marca.SAMSUNG ->
                addRow(rows, R.drawable.ds_ic_power, R.string.perm_nunca_suspender, R.string.perm_nunca_suspender_why,
                    null, false, R.string.perm_autostart_open) { OemAutostart.abrirNuncaSuspender(this) }
            OemAutostart.Marca.TRANSSION ->
                addRow(rows, R.drawable.ds_ic_power, R.string.perm_autostart, R.string.perm_phone_master_why,
                    null, false, R.string.perm_autostart_open) { openAutostart() }
            OemAutostart.Marca.OTRA -> if (OemAutostart.hayInicioAutomatico(this)) {
                addRow(rows, R.drawable.ds_ic_power, R.string.perm_autostart, R.string.perm_autostart_why,
                    null, false, R.string.perm_autostart_open) { openAutostart() }
            }
        }

        view.findViewById<android.widget.ProgressBar>(R.id.perms_progress)?.progress = if (total > 0) done * 100 / total else 0
        view.findViewById<TextView>(R.id.perms_count)?.text = getString(R.string.onboarding_perms_count_fmt, done, total)

        primary.text = if (requiredGranted()) {
            getString(R.string.onboarding_finish)
        } else {
            getString(R.string.onboarding_grant_missing)
        }
    }

    /**
     * Fila de permiso: ícono, título con etiqueta, motivo en una línea y,
     * según el estado, el botón o el visto verde. [granted] null = el sistema
     * no deja saberlo (inicio automático).
     */
    private fun addRow(
        rows: LinearLayout,
        iconRes: Int,
        titleRes: Int,
        whyRes: Int,
        granted: Boolean?,
        required: Boolean,
        actionLabelRes: Int,
        action: () -> Unit,
    ) {
        val row = LayoutInflater.from(this).inflate(R.layout.onboarding_permission_row, rows, false)
        row.findViewById<android.widget.ImageView>(R.id.row_icon).setImageResource(iconRes)
        row.findViewById<TextView>(R.id.row_title).setText(titleRes)
        // Solo los obligatorios llevan etiqueta.
        row.findViewById<TextView>(R.id.row_badge).apply {
            if (required) setText(R.string.perm_required) else visibility = View.GONE
        }
        row.findViewById<TextView>(R.id.row_status).setText(whyRes)
        val button = row.findViewById<Button>(R.id.row_action)
        val done = row.findViewById<android.widget.ImageView>(R.id.row_done)
        if (granted == true) {
            button.visibility = View.GONE
            done.visibility = View.VISIBLE
            row.findViewById<android.widget.ImageView>(R.id.row_icon).setBackgroundResource(R.drawable.ds_icon_ok)
        } else {
            button.setText(actionLabelRes)
            button.setOnClickListener {
                filaPulsada = row.findViewById(R.id.row_status)
                action()
            }
        }
        rows.addView(row)
    }

    private fun requiredGranted(): Boolean {
        if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            !isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        ) {
            return false
        }
        if (!bateriaLibre()) return false
        return notificacionesListas()
    }

    /** Permiso (Android 13+) y notificaciones encendidas en Ajustes. */
    private fun notificacionesListas(): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || isGranted(Manifest.permission.POST_NOTIFICATIONS)) &&
            AjustesPermisos.notificaciones(this)

    private fun pedirNotificaciones() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !isGranted(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        } else {
            AjustesPermisos.abrirNotificaciones(this)
        }
    }

    private fun requestMissing() {
        when {
            !isGranted(Manifest.permission.ACCESS_FINE_LOCATION) -> requestPermissions(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                REQUEST_LOCATION,
            )
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                !isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) -> requestBackground()
            !notificacionesListas() -> pedirNotificaciones()
            !bateriaLibre() -> requestBattery()
        }
    }

    /**
     * Sin optimización de batería y sin "Restringida": con la batería de la
     * app en "Restringida" (Android 9+) el servicio no puede volver a
     * arrancar desde segundo plano aunque la optimización esté quitada.
     */
    private fun bateriaLibre(): Boolean =
        ignoringBatteryOptimizations() && !AjustesPermisos.segundoPlanoRestringido(this)

    private fun pedirAlarmas() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }
    }

    private fun requestBackground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Desde Android 11 no hay diálogo: se abre Permisos > Ubicación de
            // la app para elegir "Permitir todo el tiempo".
            AjustesPermisos.abrirUbicacion(this)
        } else {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), REQUEST_BACKGROUND)
        }
    }

    private fun requestBattery() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        // Ya sin optimización pero "Restringida": se cambia en la ficha de la
        // app, Batería > Sin restricciones.
        if (ignoringBatteryOptimizations()) {
            runCatching {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
            return
        }
        runCatching {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName"),
                ),
            )
        }.onFailure {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }

    /** Texto de la fila del permiso que se tocó: ahí se avisa, sin ventanas emergentes. */
    private var filaPulsada: TextView? = null

    private fun openAutostart() {
        if (!runCatching { OemAutostart.open(this) }.getOrDefault(false)) {
            filaPulsada?.setText(R.string.perm_autostart_manual)
        }
    }

    // ── Cierre: servicio siempre encendido ──────────────────────────────────

    private fun finishOnboarding() {
        PreferenceManager.getDefaultSharedPreferences(this).edit()
            .putBoolean(Prefs.ONBOARDED, true)
            .putLong(Prefs.ONBOARDED_AT, System.currentTimeMillis())
            .putBoolean(Prefs.STATUS, true)
            .apply()
        // Si el servicio ya corría con la configuración de antes (por ejemplo,
        // lo arrancó el sistema antes del inicio de sesión), se reinicia para
        // que tome el usuario y el servidor guardados.
        if (TrackingService.isRunning) {
            RemoteConfig.restartService(this)
        } else {
            ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
        }
        // Si se llegó desde la pantalla principal (faltaba un permiso), se
        // vuelve a ella en vez de abrir otra encima.
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    private fun isGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun ignoringBatteryOptimizations(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val powerManager = getSystemService(PowerManager::class.java)
        return powerManager.isIgnoringBatteryOptimizations(packageName)
    }

    companion object {
        private const val EXTRA_STEP = "step"
        private const val KEY_STEP = "onboarding_step"
        private const val REQUEST_LOCATION = 100
        private const val REQUEST_BACKGROUND = 101
        private const val REQUEST_NOTIFICATIONS = 102
        private const val REQUEST_ACTIVITY = 103

        const val STEP_WELCOME = "welcome"
        const val STEP_LOGIN = "login"
        const val STEP_PERMISSIONS = "permissions"

        private const val EXTRA_PREVIEW = "preview"

        /**
         * Abre el asistente, opcionalmente en un paso concreto. `preview` (menú
         * de depuración) recorre el diseño sin iniciar sesión, sin reiniciar el
         * servicio y sin cambiar la configuración: al final solo se cierra.
         */
        fun start(context: Context, step: String? = null, preview: Boolean = false) {
            context.startActivity(
                Intent(context, OnboardingActivity::class.java)
                    .putExtra(EXTRA_STEP, step ?: STEP_WELCOME)
                    .putExtra(EXTRA_PREVIEW, preview),
            )
        }
    }
}

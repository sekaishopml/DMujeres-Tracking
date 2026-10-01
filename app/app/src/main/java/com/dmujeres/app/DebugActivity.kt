package com.dmujeres.app

import android.content.Context
import android.location.LocationManager
import android.os.Bundle
import android.view.LayoutInflater
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Menú de depuración (se abre con 5 toques en la versión).
 *
 * No hay pantalla de ajustes: la configuración llega del servidor. Aquí se
 * pueden ver las pantallas de la app (login, permisos, bienvenida, consola,
 * actualización) y el estado del servidor.
 */
class DebugActivity : AppCompatActivity() {

    /** Trabajo del cierre limpio en curso (se cancela al salir). */
    private var closeJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_debug)
        Responsivo.raiz(this)?.let { Responsivo.centrar(it) }
        findViewById<TextView>(R.id.version_label).text =
            getString(R.string.version_format, BuildConfig.VERSION_NAME)

        val rows = findViewById<LinearLayout>(R.id.debug_rows)

        addSection(rows, R.string.debug_section_screens)
        addRow(rows, R.string.debug_home_title, R.string.debug_home_summary) {
            startActivity(android.content.Intent(this, MainActivity::class.java))
        }
        // Las vistas previas nunca tocan la sesión ni la marca de "configurada",
        // para no dejar la app atrapada en el asistente.
        addRow(rows, R.string.debug_welcome_title, R.string.debug_welcome_summary) {
            OnboardingActivity.start(this, OnboardingActivity.STEP_WELCOME, preview = true)
        }
        addRow(rows, R.string.debug_login_title, R.string.debug_login_summary) {
            OnboardingActivity.start(this, OnboardingActivity.STEP_LOGIN, preview = true)
        }
        addRow(rows, R.string.debug_perms_title, R.string.debug_perms_summary) {
            OnboardingActivity.start(this, OnboardingActivity.STEP_PERMISSIONS, preview = true)
        }
        addRow(rows, R.string.debug_wizard_title, R.string.debug_wizard_summary) {
            OnboardingActivity.start(this, OnboardingActivity.STEP_WELCOME, preview = true)
        }
        addRow(rows, R.string.debug_console_title, R.string.debug_console_summary) {
            startActivity(android.content.Intent(this, StatusActivity::class.java))
        }
        addRow(rows, R.string.debug_update_title, R.string.debug_update_summary) {
            UpdateActivity.startDemo(this)
        }
        addRow(rows, R.string.debug_banner_title, R.string.debug_banner_summary) {
            startActivity(
                android.content.Intent(this, MainActivity::class.java)
                    .addFlags(
                        android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP,
                    )
                    .putExtra(EXTRA_BANNER_DEMO, true),
            )
        }
        addRow(rows, R.string.debug_finish_title, R.string.debug_finish_summary) {
            showFinishJourneyDialog()
        }

        addSection(rows, R.string.debug_section_backend)
        addRow(rows, R.string.debug_server_title, R.string.debug_server_summary) { editServer() }
        addRow(rows, R.string.debug_user_title, R.string.debug_user_summary) { testUser() }
        addRow(rows, R.string.debug_diagnostics_title, R.string.debug_diagnostics_summary) {
            showDiagnostics()
        }
        addRow(rows, R.string.debug_buffer_title, R.string.debug_buffer_summary) { showBuffer() }
        addRow(rows, R.string.debug_clear_console_title, R.string.debug_clear_console_summary) {
            StatusActivity.clearMessages()
            toast(getString(R.string.debug_clear_console_done))
        }

        // "Finalizar sesión" va en rojo, debajo de "vaciar consola", y está
        // también en la versión publicada. Pide confirmación; sin sesión solo
        // abre el inicio de sesión.
        addDestructiveRow(
            rows,
            R.string.debug_close_session_title,
            R.string.debug_close_session_summary,
        ) {
            showCloseSessionDialog()
        }
    }

    override fun onDestroy() {
        runCatching { closeJob?.cancel() }
        super.onDestroy()
    }

    // ── Diseño de filas ─────────────────────────────────────────────────────

    private fun addSection(rows: LinearLayout, titleRes: Int) {
        val density = resources.displayMetrics.density
        val title = TextView(this).apply {
            setText(titleRes)
            setTextColor(androidx.core.content.ContextCompat.getColor(context, R.color.muted))
            textSize = 12f
            letterSpacing = 0.08f
            setPadding(
                (4 * density).toInt(),
                ((if (rows.childCount == 0) 8 else 28) * density).toInt(),
                (4 * density).toInt(),
                (10 * density).toInt(),
            )
        }
        rows.addView(title)
    }

    private fun addRow(rows: LinearLayout, titleRes: Int, summaryRes: Int, action: () -> Unit) {
        val row = LayoutInflater.from(this).inflate(R.layout.debug_row, rows, false)
        row.findViewById<TextView>(R.id.row_title).setText(titleRes)
        row.findViewById<TextView>(R.id.row_summary).setText(summaryRes)
        row.setOnClickListener { action() }
        rows.addView(row)
    }

    /** Variante con resumen dinámico (p. ej. usuario de la sesión actual). */
    private fun addRow(rows: LinearLayout, titleRes: Int, summary: String, action: () -> Unit) {
        val row = LayoutInflater.from(this).inflate(R.layout.debug_row, rows, false)
        row.findViewById<TextView>(R.id.row_title).setText(titleRes)
        row.findViewById<TextView>(R.id.row_summary).text = summary
        row.setOnClickListener { action() }
        rows.addView(row)
    }

    /** Fila destructiva: título en rojo (acción que cierra/borra). */
    private fun addDestructiveRow(rows: LinearLayout, titleRes: Int, summaryRes: Int, action: () -> Unit) {
        val row = LayoutInflater.from(this).inflate(R.layout.debug_row, rows, false)
        row.findViewById<TextView>(R.id.row_title).apply {
            setText(titleRes)
            setTextColor(ContextCompat.getColor(context, R.color.primary))
        }
        row.findViewById<TextView>(R.id.row_summary).setText(summaryRes)
        row.setOnClickListener { action() }
        rows.addView(row)
    }

    // ── Pantallas ───────────────────────────────────────────────────────────

    /** Mismo diálogo del home, con la duración real de la jornada. */
    private fun showFinishJourneyDialog() {
        val startedAt = PreferenceManager.getDefaultSharedPreferences(this)
            .getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L)
        val minutes = if (startedAt > 0L) {
            ((System.currentTimeMillis() - startedAt) / 60_000L).toInt()
        } else {
            0
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.journey_confirm_title)
            .setMessage(getString(R.string.journey_confirm_body, minutes / 60, minutes % 60))
            .setPositiveButton(R.string.journey_confirm_ok) { _, _ ->
                DmujeresApi.journeyEnded(this)
            }
            .setNegativeButton(R.string.journey_confirm_cancel, null)
            .show()
    }

    // ── Backend ─────────────────────────────────────────────────────────────

    /** Muestra el usuario y permite cambiar la URL interna del servidor. */
    private fun editServer() {
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val field = EditText(this).apply {
            setText(prefs.getString(Prefs.URL, ""))
            setHint(R.string.debug_server_hint)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 8, 48, 0)
            addView(TextView(this@DebugActivity).apply {
                text = getString(
                    R.string.debug_server_user_fmt,
                    prefs.getString(Prefs.DEVICE, ""),
                )
                setTextColor(androidx.core.content.ContextCompat.getColor(context, R.color.muted))
                textSize = 13f
            })
            addView(field)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.debug_server_title)
            .setView(container)
            .setPositiveButton(R.string.debug_save) { _, _ ->
                prefs.edit().putString(Prefs.URL, field.text.toString().trim()).apply()
                // El servicio toma la URL al arrancar: se reinicia para que el
                // cambio se aplique ya (con guardas de arranque).
                if (TrackingService.isRunning) {
                    RemoteConfig.restartService(this)
                }
                toast(getString(R.string.debug_server_saved))
            }
            .setNegativeButton(R.string.debug_close, null)
            .show()
    }

    /** Verifica el usuario configurado contra el servidor (como el login). */
    private fun testUser() {
        val user = PreferenceManager.getDefaultSharedPreferences(this)
            .getString(Prefs.DEVICE, "").orEmpty()
        toast(getString(R.string.debug_testing_user))
        Thread {
            val exists = DmujeresApi.userExists(this, user)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                toast(
                    getString(
                        when (exists) {
                            true -> R.string.debug_user_ok
                            false -> R.string.debug_user_unknown
                            null -> R.string.debug_user_offline
                        },
                    ),
                )
            }
        }.start()
    }

    /** Resumen local del estado del servicio (sin adb ni panel). */
    private fun showDiagnostics() {
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        val locationOn = runCatching {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager)
                .isProviderEnabled(LocationManager.GPS_PROVIDER)
        }.getOrDefault(false)
        val pending = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(-1)
        val journeyOpen = DmujeresApi.isJourneyOpen(this)
        val lines = listOf(
            getString(
                R.string.debug_diag_service_fmt,
                getString(if (TrackingService.isRunning) R.string.debug_active else R.string.debug_stopped),
            ),
            getString(
                R.string.debug_diag_gps_fmt,
                getString(if (locationOn) R.string.debug_on else R.string.debug_off),
            ),
            getString(R.string.debug_diag_pending_fmt, pending),
            getString(
                R.string.debug_diag_journey_fmt,
                if (journeyOpen) {
                    getString(R.string.debug_open_since, DmujeresApi.journeyStartedAtLabel(this))
                } else {
                    getString(R.string.debug_closed)
                },
            ),
            getString(
                R.string.debug_diag_connection_fmt,
                getString(if (ConnectionState.isFailing()) R.string.debug_failing else R.string.debug_ok),
            ),
            getString(
                R.string.debug_diag_config_fmt,
                prefs.getString(Prefs.INTERVAL, "60"),
                prefs.getString(Prefs.DISTANCE, "10"),
                prefs.getString(Prefs.ANGLE, "15"),
                prefs.getString(Prefs.ACCURACY, "medium"),
            ),
            getString(
                R.string.debug_diag_perms_fmt,
                yesNo(
                    androidx.core.content.ContextCompat.checkSelfPermission(
                        this, android.Manifest.permission.ACCESS_FINE_LOCATION,
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED,
                ),
                yesNo(
                    android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q ||
                        androidx.core.content.ContextCompat.checkSelfPermission(
                            this, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED,
                ),
                yesNo(
                    android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
                        androidx.core.content.ContextCompat.checkSelfPermission(
                            this, android.Manifest.permission.POST_NOTIFICATIONS,
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED,
                ),
                yesNo(
                    android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M ||
                        (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                            .isIgnoringBatteryOptimizations(packageName),
                ),
            ),
            getString(R.string.debug_diag_user_fmt, prefs.getString(Prefs.DEVICE, "")),
            getString(R.string.debug_diag_server_fmt, prefs.getString(Prefs.URL, "")),
            getString(
                R.string.debug_diag_version_fmt,
                BuildConfig.VERSION_NAME,
                BuildConfig.VERSION_CODE,
            ),
        )
        AlertDialog.Builder(this)
            .setTitle(R.string.debug_diagnostics_title)
            .setMessage(lines.joinToString("\n"))
            .setPositiveButton(R.string.debug_close, null)
            .show()
    }

    private fun showBuffer() {
        Thread {
            val pending = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(-1)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                toast(getString(R.string.debug_buffer_toast, pending))
            }
        }.start()
    }

    // ── Finalizar sesión (solo debug) ──────────────────────────────────────────

    /**
     * Finalizar sesión: pide confirmación. El cierre envía lo pendiente y
     * cierra la jornada antes de borrar la sesión.
     */
    private fun showCloseSessionDialog() {
        val pending = runCatching { DatabaseHelper(this).countPositions() }.getOrDefault(-1)
        AlertDialog.Builder(this)
            .setTitle(R.string.debug_close_session_title)
            .setMessage(
                if (pending > 0) {
                    getString(R.string.debug_close_session_confirm_fmt, pending)
                } else {
                    getString(R.string.debug_close_session_confirm_empty)
                },
            )
            .setPositiveButton(R.string.debug_close_session_ok) { _, _ ->
                runCloseSession()
            }
            .setNegativeButton(R.string.debug_close, null)
            .show()
    }

    /**
     * Corre el cierre sin trabar la pantalla: un diálogo de avance que no se
     * puede cancelar, con tope de unos 30 s. Al terminar dice si cerró todo o
     * qué faltó y, si la sesión quedó borrada, abre el inicio de sesión.
     */
    private fun runCloseSession() {
        if (closeJob?.isActive == true) return
        val progress = AlertDialog.Builder(this)
            .setTitle(R.string.debug_close_session_title)
            .setMessage(getString(R.string.debug_close_session_start))
            .setCancelable(false)
            .create()
        progress.show()
        closeJob = CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
            val report = SessionCloser.cerrarSesionLimpia(this@DebugActivity) { sent, remaining ->
                runOnUiThread {
                    if (!isFinishing && !isDestroyed && progress.isShowing) {
                        progress.setMessage(
                            getString(
                                R.string.debug_close_session_progress_fmt,
                                sent,
                                remaining.coerceAtLeast(0),
                            ),
                        )
                    }
                }
            }
            if (!isFinishing && !isDestroyed) {
                runCatching { progress.dismiss() }
                showCloseResult(report)
            }
        }
    }

    /** Informe humano del cierre: completo o qué faltó (sin jerga). */
    private fun showCloseResult(report: SessionClosePlan.CloseReport) {
        if (!report.sessionCleared) {
            AlertDialog.Builder(this)
                .setTitle(R.string.debug_close_session_title)
                .setMessage(getString(R.string.debug_close_session_not_cleared))
                .setPositiveButton(R.string.debug_close, null)
                .show()
            return
        }
        if (report.isComplete()) {
            toast(getString(R.string.debug_close_session_done_fmt, report.sent))
            LoginActivity.start(this)
            finish()
            return
        }
        val lines = ArrayList<String>()
        if (report.remaining > 0) {
            lines.add(getString(R.string.debug_close_session_remaining_fmt, report.remaining))
        } else if (report.remaining < 0) {
            lines.add(getString(R.string.debug_close_session_remaining_fmt, 0))
        }
        if (report.journey == SessionClosePlan.JourneyOutcome.OFFLINE) {
            lines.add(getString(R.string.debug_close_session_journey_offline))
        }
        if (report.authFailed) {
            lines.add(getString(R.string.debug_close_session_auth))
        }
        if (lines.isEmpty()) {
            lines.add(getString(R.string.debug_close_session_done_fmt, report.sent))
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.debug_close_session_title)
            .setMessage(lines.joinToString("\n\n"))
            .setPositiveButton(R.string.debug_close) { _, _ ->
                LoginActivity.start(this)
                finish()
            }
            .show()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun yesNo(value: Boolean): String =
        getString(if (value) R.string.debug_yes else R.string.debug_no)
}

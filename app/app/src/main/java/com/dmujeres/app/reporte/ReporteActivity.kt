package com.dmujeres.app.reporte

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Patterns
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.preference.PreferenceManager
import com.dmujeres.app.R
import com.dmujeres.app.cronograma.Actividades
import com.dmujeres.app.pantallas.Animaciones
import com.dmujeres.app.pantallas.Responsivo
import com.dmujeres.app.red.DmujeresApi
import com.dmujeres.app.sesion.SessionStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Mi reporte: diario, semanal o mensual, con las actividades del cronograma
 * y la jornada de cada día. Se descarga en Excel o imagen (Descargas/DMujeres)
 * o se manda al correo de la persona, que queda guardado hasta que lo cambie.
 */
class ReporteActivity : AppCompatActivity() {

    private var periodo = Periodo.SEMANA
    private var fecha = hoy()
    private var reporte: Reporte? = null

    /** Cada carga lleva su número: una respuesta vieja no pisa a la nueva. */
    private var carga = 0

    private val prefs by lazy { PreferenceManager.getDefaultSharedPreferences(this) }
    private val estado by lazy { findViewById<TextView>(R.id.rep_estado) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_reporte)
        Responsivo.raiz(this)?.let { Responsivo.centrar(it) }
        findViewById<View>(R.id.rep_volver).setOnClickListener { finish() }
        mapOf(R.id.rep_dia to Periodo.DIA, R.id.rep_semana to Periodo.SEMANA, R.id.rep_mes to Periodo.MES).forEach { (id, p) ->
            findViewById<View>(id).setOnClickListener { periodo = p; cargar() }
        }
        findViewById<View>(R.id.rep_anterior).setOnClickListener { fecha = DatosReporte.mover(periodo, fecha, -1); cargar() }
        findViewById<View>(R.id.rep_siguiente).setOnClickListener { fecha = DatosReporte.mover(periodo, fecha, 1); cargar() }
        findViewById<View>(R.id.rep_correo_cambiar).setOnClickListener { editarCorreo(true) }
        findViewById<View>(R.id.rep_correo_guardar).setOnClickListener { guardarCorreo() }
        findViewById<EditText>(R.id.rep_correo_campo).setOnEditorActionListener { _, _, _ -> guardarCorreo(); true }
        findViewById<View>(R.id.rep_excel).setOnClickListener { descargarExcel() }
        findViewById<View>(R.id.rep_imagen).setOnClickListener { descargarImagen() }
        findViewById<View>(R.id.rep_enviar).setOnClickListener { enviar() }
        Animaciones.respuestaAlToque(
            findViewById(R.id.rep_excel), findViewById(R.id.rep_imagen), findViewById(R.id.rep_enviar),
            findViewById(R.id.rep_dia), findViewById(R.id.rep_semana), findViewById(R.id.rep_mes),
        )
        pintarCorreo()
        cargar()
    }

    // ── Datos ───────────────────────────────────────────────────────────────

    private fun cargar() {
        val mia = ++carga
        mapOf(R.id.rep_dia to Periodo.DIA, R.id.rep_semana to Periodo.SEMANA, R.id.rep_mes to Periodo.MES).forEach { (id, p) ->
            findViewById<TextView>(id).apply {
                isSelected = p == periodo
                setTextColor(getColor(if (p == periodo) R.color.white else R.color.text_primary))
            }
        }
        val (desde, hasta) = DatosReporte.rango(periodo, fecha)
        findViewById<TextView>(R.id.rep_rango).text =
            if (desde == hasta) DatosReporte.etiquetaDia(desde) else "${DatosReporte.corta(desde)} – ${DatosReporte.corta(hasta)}"
        // Primero lo que ya hay en el teléfono; después, con el servidor.
        pintar(armar(null))
        mostrarEstado(getString(R.string.rep_cargando))
        Actividades.actualizar(this, desde, hasta) { _ ->
            val respuesta = DmujeresApi.fetchJornadas(this, desde, hasta)
            val jornadas = respuesta?.optJSONArray("jornadas")?.let { jornadasDe(it) }
            respuesta?.optString("correo")?.takeIf { it.isNotBlank() && it != "null" && correo() == null }?.let {
                prefs.edit().putString(KEY_CORREO, it).apply()
            }
            runOnUiThread {
                if (mia != carga || isFinishing || isDestroyed) return@runOnUiThread
                pintarCorreo()
                pintar(armar(jornadas))
                mostrarEstado(if (jornadas == null) getString(R.string.rep_sin_conexion_jornadas) else "")
            }
        }
    }

    private fun jornadasDe(a: JSONArray): Map<String, List<JornadaDia>> =
        List(a.length()) { a.getJSONObject(it) }.groupBy({ it.getString("fecha") }) { o ->
            JornadaDia(
                o.getString("inicio"),
                o.optString("fin").takeIf { it.isNotBlank() && it != "null" },
                o.optBoolean("abierta"),
                o.optString("notaFin").takeIf { it.isNotBlank() && it != "null" },
            )
        }

    private fun armar(jornadas: Map<String, List<JornadaDia>>?): Reporte {
        val nombre = prefs.getString(SessionStore.KEY_NAME, null)?.takeIf { it.isNotBlank() } ?: "—"
        return DatosReporte.armar(periodo, fecha, nombre, { f ->
            Actividades.delDia(this, f).map { FilaActividad(it.hora, it.horaFin, it.tipo.etiqueta, it.lugar, it.nota) }
        }, jornadas).also { reporte = it }
    }

    /** La misma planilla que el Excel y la imagen; la semana se recorre de lado. */
    private fun pintar(r: Reporte) {
        val contenedor = findViewById<FrameLayout>(R.id.rep_vista)
        contenedor.removeAllViews()
        val imagen = ImagenReporte.bitmap(r)
        val escala = resources.displayMetrics.density / 3f
        contenedor.addView(android.widget.HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(android.widget.ImageView(this@ReporteActivity).apply {
                setImageBitmap(imagen)
                scaleType = android.widget.ImageView.ScaleType.FIT_XY
                layoutParams = android.view.ViewGroup.LayoutParams((imagen.width * escala).toInt(), (imagen.height * escala).toInt())
            })
        })
    }

    // ── Descargas ───────────────────────────────────────────────────────────

    private fun excel(r: Reporte): ByteArray =
        ReporteExcel.bytes(r, SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.US).apply { timeZone = ZONA }.format(Date()))

    private fun png(r: Reporte): ByteArray = ByteArrayOutputStream().also {
        ImagenReporte.bitmap(r).compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
    }.toByteArray()

    private fun descargarExcel() {
        val r = reporte ?: return
        guardarYOfrecer("${r.nombreArchivo}.xlsx", MIME_XLSX, excel(r))
    }

    private fun descargarImagen() {
        val r = reporte ?: return
        guardarYOfrecer("${r.nombreArchivo}.png", MIME_PNG, png(r))
    }

    private fun guardarYOfrecer(nombre: String, mime: String, bytes: ByteArray) {
        val uri = runCatching { guardar(nombre, mime, bytes) }.getOrNull()
        if (uri == null) {
            mostrarEstado(getString(R.string.rep_no_guardado))
            return
        }
        mostrarEstado(getString(R.string.rep_guardado_fmt)) {
            val abrir = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { startActivity(abrir) }.onFailure { mostrarEstado(getString(R.string.rep_sin_app)) }
        }
    }

    /** Android 10+: carpeta Descargas/DMujeres sin pedir permisos; antes, la carpeta de la app. */
    private fun guardar(nombre: String, mime: String, bytes: ByteArray): Uri? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val valores = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, nombre)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/DMujeres")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores) ?: return null
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
            return uri
        }
        val carpeta = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
        val archivo = File(carpeta, nombre).apply { writeBytes(bytes) }
        return FileProvider.getUriForFile(this, "$packageName.fileprovider", archivo)
    }

    // ── Correo ──────────────────────────────────────────────────────────────

    private fun correo(): String? = prefs.getString(KEY_CORREO, null)?.takeIf { it.isNotBlank() }

    private fun pintarCorreo() {
        val guardado = correo()
        findViewById<TextView>(R.id.rep_correo_texto).text =
            guardado?.let { getString(R.string.rep_correo_fmt, it) } ?: getString(R.string.rep_sin_correo)
        if (guardado == null && findViewById<View>(R.id.rep_correo_editor).visibility != View.VISIBLE) editarCorreo(true, foco = false)
    }

    private fun editarCorreo(si: Boolean, foco: Boolean = true) {
        findViewById<View>(R.id.rep_correo_editor).visibility = if (si) View.VISIBLE else View.GONE
        findViewById<View>(R.id.rep_correo_cambiar).visibility = if (si) View.GONE else View.VISIBLE
        val campo = findViewById<EditText>(R.id.rep_correo_campo)
        val teclado = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        if (si) {
            campo.setText(correo().orEmpty())
            campo.setSelection(campo.text.length)
            if (foco) {
                campo.requestFocus()
                campo.post { teclado.showSoftInput(campo, InputMethodManager.SHOW_IMPLICIT) }
            }
        } else {
            teclado.hideSoftInputFromWindow(campo.windowToken, 0)
            campo.clearFocus()
        }
    }

    /** Guarda el correo escrito; false si no es válido (se avisa abajo). */
    private fun guardarCorreo(): Boolean {
        val escrito = findViewById<EditText>(R.id.rep_correo_campo).text.toString().trim().lowercase()
        if (!Patterns.EMAIL_ADDRESS.matcher(escrito).matches()) {
            mostrarEstado(getString(R.string.rep_correo_invalido))
            return false
        }
        prefs.edit().putString(KEY_CORREO, escrito).apply()
        editarCorreo(false)
        pintarCorreo()
        mostrarEstado(getString(R.string.rep_correo_guardado))
        return true
    }

    private fun enviar() {
        val r = reporte ?: return
        // Con el editor abierto, lo escrito es el correo a usar.
        if (findViewById<View>(R.id.rep_correo_editor).visibility == View.VISIBLE && !guardarCorreo()) return
        val destino = correo() ?: return editarCorreo(true)
        mostrarEstado(getString(R.string.rep_enviando))
        findViewById<View>(R.id.rep_enviar).isEnabled = false
        Thread {
            val cuerpo = runCatching {
                JSONObject()
                    .put("correo", destino)
                    .put("asunto", "${r.titulo} · ${r.nombre} · ${r.rango}")
                    .put(
                        "archivos",
                        JSONArray()
                            .put(adjunto("${r.nombreArchivo}.xlsx", MIME_XLSX, excel(r)))
                            .put(adjunto("${r.nombreArchivo}.png", MIME_PNG, png(r))),
                    )
            }.getOrNull()
            val codigo = cuerpo?.let { DmujeresApi.enviarReporte(this, it) } ?: 0
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                findViewById<View>(R.id.rep_enviar).isEnabled = true
                mostrarEstado(
                    when (codigo) {
                        in 200..299 -> getString(R.string.rep_enviado_fmt, destino)
                        503 -> getString(R.string.rep_envio_sin_configurar)
                        429 -> getString(R.string.rep_envio_muchos)
                        -1 -> getString(R.string.rep_envio_sin_red)
                        else -> getString(R.string.rep_envio_fallo)
                    },
                )
            }
        }.start()
    }

    private fun adjunto(nombre: String, mime: String, bytes: ByteArray) = JSONObject()
        .put("nombre", nombre)
        .put("tipo", mime)
        .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))

    /** Línea de estado de abajo; con [alTocar], tocarla hace eso (abrir el archivo). */
    private fun mostrarEstado(texto: String, alTocar: (() -> Unit)? = null) {
        Animaciones.texto(estado, texto)
        estado.setTextColor(getColor(if (alTocar != null) R.color.primary else R.color.text_secondary))
        estado.setOnClickListener(alTocar?.let { a -> View.OnClickListener { a() } })
    }

    companion object {
        const val KEY_CORREO = "correoReporte"
        private const val MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        private const val MIME_PNG = "image/png"
        private val ZONA: TimeZone = TimeZone.getTimeZone("America/Guayaquil")

        private fun hoy(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = ZONA }.format(Date())
    }
}

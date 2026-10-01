package com.dmujeres.app.cronograma

import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceManager
import com.dmujeres.app.DmujeresApi
import com.dmujeres.app.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Cronograma de actividades.
 *
 * - Abre en HOY: la semana arriba (un punto marca los días con actividades) y
 *   la lista del día con las actividades, los huecos sin registrar (desde el
 *   inicio de jornada hasta ahora) y la hora actual. La actividad en curso
 *   tiene "Terminé" para cerrarla a la hora real.
 * - El ícono de calendario muestra el mes; tocar un día vuelve a la lista.
 * - Agregar o editar abre ActividadActivity.
 * - Todo se guarda al momento en el teléfono y se sube cuando hay conexión.
 */
class CronogramaActivity : AppCompatActivity() {

    private val zona = TimeZone.getTimeZone("America/Guayaquil")
    private val iso = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }
    private val es = Locale("es", "EC")

    private var enMes = false
    private lateinit var dia: Calendar
    private lateinit var mes: Calendar

    /** Al volver a la pantalla, si se estaba en hoy y cambió la fecha, sigue en hoy. */
    private var seguirHoy = true
    private val reloj = Handler(Looper.getMainLooper())
    private val alMinuto = object : Runnable {
        override fun run() {
            if (!enMes && fechaDe(dia) == hoy()) pintar()
            reloj.postDelayed(this, 60_000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_cronograma)
        com.dmujeres.app.Responsivo.raiz(this)?.let {
            com.dmujeres.app.Responsivo.centrarHijos(it, com.dmujeres.app.Responsivo.ANCHO_PANEL_DP)
        }
        dia = Calendar.getInstance(zona)
        // Al girar la tablet se conserva el día y la vista (mes o día).
        savedInstanceState?.getLong(KEY_DIA, 0L)?.takeIf { it > 0 }?.let { dia.timeInMillis = it }
        mes = primeroDelMes(dia)
        enMes = savedInstanceState?.getBoolean(KEY_EN_MES) ?: false
        savedInstanceState?.getLong(KEY_MES, 0L)?.takeIf { it > 0 }?.let { mes.timeInMillis = it }

        findViewById<View>(R.id.crono_back).setOnClickListener { finish() }
        findViewById<View>(R.id.crono_prev).setOnClickListener { mover(-1) }
        findViewById<View>(R.id.crono_next).setOnClickListener { mover(1) }
        findViewById<View>(R.id.crono_modo).setOnClickListener { cambiarModo() }
        findViewById<View>(R.id.crono_titulo).setOnClickListener { cambiarModo() }
        findViewById<View>(R.id.crono_ir_hoy).setOnClickListener {
            dia = Calendar.getInstance(zona)
            mes = primeroDelMes(dia)
            pintar()
            refrescarDelServidor()
        }
        findViewById<View>(R.id.crono_agregar).setOnClickListener {
            // Desde el mes se agrega al día elegido y se vuelve a su lista.
            enMes = false
            ActividadActivity.abrir(this, fechaDe(dia))
        }
        cabeceraSemana()
        pintar()
    }

    override fun onResume() {
        super.onResume()
        if (seguirHoy && fechaDe(dia) != hoy()) {
            dia = Calendar.getInstance(zona)
            mes = primeroDelMes(dia)
        }
        pintar()
        refrescarDelServidor()
        reloj.postDelayed(alMinuto, 60_000L)
    }

    override fun onPause() {
        super.onPause()
        seguirHoy = fechaDe(dia) == hoy()
        reloj.removeCallbacks(alMinuto)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(KEY_EN_MES, enMes)
        outState.putLong(KEY_DIA, dia.timeInMillis)
        outState.putLong(KEY_MES, mes.timeInMillis)
    }

    private fun cambiarModo() {
        enMes = !enMes
        mes = primeroDelMes(dia)
        pintar()
        refrescarDelServidor()
    }

    // ── Navegación ─────────────────────────────────────────────────────────

    private fun primeroDelMes(c: Calendar): Calendar = (c.clone() as Calendar).apply {
        set(Calendar.DAY_OF_MONTH, 1)
    }

    private fun mover(paso: Int) {
        if (enMes) {
            mes.add(Calendar.MONTH, paso)
            refrescarDelServidor()
        } else {
            // En la vista día las flechas pasan de semana (mismo día de la semana).
            dia.add(Calendar.DAY_OF_MONTH, 7 * paso)
            mes = primeroDelMes(dia)
            refrescarDelServidor()
        }
        pintar()
    }

    private fun fechaDe(c: Calendar): String = iso.format(c.time)
    private fun hoy(): String = iso.format(Calendar.getInstance(zona).time)

    private fun lunesDe(c: Calendar): Calendar = (c.clone() as Calendar).apply {
        add(Calendar.DAY_OF_MONTH, -((get(Calendar.DAY_OF_WEEK) + 5) % 7))
    }

    /** Trae el mes elegido y la semana visible (puede tocar dos meses). */
    private fun refrescarDelServidor() {
        val fin = (mes.clone() as Calendar).apply { set(Calendar.DAY_OF_MONTH, getActualMaximum(Calendar.DAY_OF_MONTH)) }
        val lunes = lunesDe(dia)
        val domingo = (lunes.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 6) }
        val desde = minOf(fechaDe(mes), fechaDe(lunes))
        val hasta = maxOf(fechaDe(fin), fechaDe(domingo))
        Actividades.sincronizar(this) {
            Actividades.actualizar(this, desde, hasta) { ok ->
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    pintar()
                    estadoSincronizacion(ok)
                }
            }
        }
    }

    private fun estadoSincronizacion(conectado: Boolean) {
        val pendientes = Actividades.pendientes(this)
        val sync = Actividades.sincronizadoEn(this)
        findViewById<TextView>(R.id.crono_sync).text = when {
            pendientes > 0 -> getString(R.string.crono_sync_pend_fmt, pendientes)
            !conectado && sync <= 0L -> getString(R.string.crono_sync_offline)
            sync > 0L -> getString(
                R.string.crono_sync_at_fmt,
                SimpleDateFormat("HH:mm", Locale.US).apply { timeZone = zona }.format(java.util.Date(sync)),
            )
            else -> getString(R.string.crono_sync_nunca)
        }
    }

    // ── Pintado ────────────────────────────────────────────────────────────

    private fun formato(patron: String, c: Calendar): String =
        SimpleDateFormat(patron, es).apply { timeZone = zona }.format(c.time).replaceFirstChar { it.uppercase() }

    private fun pintar() {
        val titulo = findViewById<TextView>(R.id.crono_titulo)
        findViewById<View>(R.id.crono_mes).visibility = if (enMes) View.VISIBLE else View.GONE
        findViewById<View>(R.id.crono_dia).visibility = if (enMes) View.GONE else View.VISIBLE
        findViewById<View>(R.id.crono_semana).visibility = if (enMes) View.GONE else View.VISIBLE
        findViewById<View>(R.id.crono_dia_cab).visibility = if (enMes) View.GONE else View.VISIBLE
        if (enMes) {
            titulo.text = formato("LLLL 'de' yyyy", mes)
            pintarMes()
        } else {
            titulo.text = formato("LLLL yyyy", dia)
            pintarSemana()
            pintarDia()
        }
        estadoSincronizacion(true)
    }

    private fun cabeceraSemana() {
        val cab = findViewById<LinearLayout>(R.id.crono_semana_cab)
        listOf("L", "M", "M", "J", "V", "S", "D").forEach { letra ->
            cab.addView(TextView(this).apply {
                text = letra
                gravity = Gravity.CENTER
                setTextColor(getColor(R.color.text_tertiary))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setTypeface(typeface, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, dp(24), 1f)
            })
        }
    }

    private fun pintarMes() {
        val grilla = findViewById<LinearLayout>(R.id.crono_grilla)
        grilla.removeAllViews()
        val prefijoMes = fechaDe(mes).substring(0, 7)
        val delMes = Actividades.delMes(this, prefijoMes).groupBy { it.fecha }
        val cursor = (mes.clone() as Calendar)
        // Semana de lunes a domingo.
        val desfase = (cursor.get(Calendar.DAY_OF_WEEK) + 5) % 7
        cursor.add(Calendar.DAY_OF_MONTH, -desfase)
        val hoy = hoy()
        val seleccion = fechaDe(dia)
        repeat(6) {
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            }
            repeat(7) {
                val fecha = fechaDe(cursor)
                val delDia = delMes[fecha].orEmpty()
                val esDelMes = fecha.startsWith(prefijoMes)
                val celda = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    setPadding(0, dp(4), 0, 0)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
                    setBackgroundResource(R.drawable.ds_celda_dia)
                    isSelected = fecha == seleccion
                    alpha = if (esDelMes) 1f else 0.35f
                }
                celda.addView(TextView(this).apply {
                    text = cursor.get(Calendar.DAY_OF_MONTH).toString()
                    gravity = Gravity.CENTER
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    if (fecha == hoy) {
                        setBackgroundResource(R.drawable.ds_hoy)
                        setTextColor(getColor(R.color.white))
                        setTypeface(typeface, Typeface.BOLD)
                    } else {
                        setTextColor(getColor(R.color.text_primary))
                    }
                    layoutParams = LinearLayout.LayoutParams(dp(26), dp(26))
                })
                if (delDia.isNotEmpty()) {
                    val (color, fondo) = colorTipo(delDia.first().tipo)
                    celda.addView(TextView(this).apply {
                        text = delDia.size.toString()
                        gravity = Gravity.CENTER
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                        setTypeface(typeface, Typeface.BOLD)
                        setTextColor(getColor(color))
                        setBackgroundResource(fondo)
                        setPadding(dp(6), 0, dp(6), 0)
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                        ).apply { topMargin = dp(2) }
                    })
                }
                val c = cursor.clone() as Calendar
                celda.setOnClickListener {
                    dia = c
                    mes = primeroDelMes(c)
                    enMes = false
                    pintar()
                    refrescarDelServidor()
                }
                fila.addView(celda)
                cursor.add(Calendar.DAY_OF_MONTH, 1)
            }
            grilla.addView(fila)
        }
    }

    /** Tira L–D de la semana del día elegido; tocar un día lo abre. */
    private fun pintarSemana() {
        val tira = findViewById<LinearLayout>(R.id.crono_semana)
        tira.removeAllViews()
        val lunes = lunesDe(dia)
        val domingo = (lunes.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 6) }
        val conActividad = Actividades.fechasConActividad(this, fechaDe(lunes), fechaDe(domingo))
        val hoy = hoy()
        val elegido = fechaDe(dia)
        val cursor = lunes.clone() as Calendar
        listOf("L", "M", "M", "J", "V", "S", "D").forEach { letra ->
            val fecha = fechaDe(cursor)
            val celda = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                    setMargins(dp(2), dp(4), dp(2), dp(4))
                }
                setBackgroundResource(R.drawable.ds_celda_dia)
                isSelected = fecha == elegido
            }
            celda.addView(TextView(this).apply {
                text = letra
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(getColor(if (fecha == elegido) R.color.primary else R.color.text_tertiary))
            })
            celda.addView(TextView(this).apply {
                text = cursor.get(Calendar.DAY_OF_MONTH).toString()
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTypeface(typeface, Typeface.BOLD)
                when {
                    fecha == hoy && fecha == elegido -> {
                        setBackgroundResource(R.drawable.ds_hoy)
                        setTextColor(getColor(R.color.white))
                    }
                    fecha == hoy -> {
                        setBackgroundResource(R.drawable.ds_hoy_borde)
                        setTextColor(getColor(R.color.primary))
                    }
                    else -> setTextColor(getColor(R.color.text_primary))
                }
                layoutParams = LinearLayout.LayoutParams(dp(26), dp(26))
            })
            celda.addView(View(this).apply {
                setBackgroundResource(R.drawable.ds_punto)
                visibility = if (fecha in conActividad) View.VISIBLE else View.INVISIBLE
                layoutParams = LinearLayout.LayoutParams(dp(5), dp(5)).apply { topMargin = dp(2) }
            })
            val c = cursor.clone() as Calendar
            celda.setOnClickListener {
                dia = c
                mes = primeroDelMes(c)
                pintar()
            }
            tira.addView(celda)
            cursor.add(Calendar.DAY_OF_MONTH, 1)
        }
    }

    private fun minutosAhora(): Int {
        val c = Calendar.getInstance(zona)
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    /** Inicio de jornada de hoy en minutos (si la jornada de hoy ya empezó). */
    private fun inicioJornadaHoy(): Int? {
        val en = PreferenceManager.getDefaultSharedPreferences(this).getLong(DmujeresApi.KEY_JOURNEY_STARTED_AT, 0L)
        if (en <= 0L) return null
        val c = Calendar.getInstance(zona).apply { timeInMillis = en }
        if (fechaDe(c) != hoy()) return null
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    private fun etiquetaDia(): String {
        val fecha = fechaDe(dia)
        val texto = formato("EEEE d 'de' MMMM", dia)
        val ayer = Calendar.getInstance(zona).apply { add(Calendar.DAY_OF_MONTH, -1) }
        val manana = Calendar.getInstance(zona).apply { add(Calendar.DAY_OF_MONTH, 1) }
        val prefijo = when (fecha) {
            hoy() -> getString(R.string.crono_hoy)
            fechaDe(ayer) -> getString(R.string.crono_ayer)
            fechaDe(manana) -> getString(R.string.crono_manana)
            else -> return texto
        }
        return "$prefijo · ${texto.lowercase(es)}"
    }

    /** Elemento de la lista del día: actividad, hueco sin registrar o la hora actual. */
    private sealed class Fila(val minuto: Int, val orden: Int) {
        class DeActividad(val a: Actividad, minuto: Int) : Fila(minuto, 1)
        class Hueco(val tramo: AgendaDia.Tramo) : Fila(tramo.inicio, 0)
        class Ahora(minuto: Int) : Fila(minuto, 2)
    }

    private fun pintarDia() {
        val lista = findViewById<LinearLayout>(R.id.crono_lista)
        lista.removeAllViews()
        val fecha = fechaDe(dia)
        val hoy = hoy()
        val esHoy = fecha == hoy
        val delDia = Actividades.delDia(this, fecha)
        val ahora = minutosAhora()
        val ahoraTexto = HoraCronograma.deMinutos(ahora)
        val enCurso = if (esHoy) HoraCronograma.enCurso(delDia, ahoraTexto, { it.hora }, { it.horaFin }) else null

        findViewById<TextView>(R.id.crono_dia_titulo).text = etiquetaDia()
        findViewById<View>(R.id.crono_ir_hoy).visibility = if (esHoy) View.GONE else View.VISIBLE
        val conFin = delDia.mapNotNull { a ->
            a.horaFin?.let { AgendaDia.Tramo(HoraCronograma.aMinutos(a.hora), HoraCronograma.aMinutos(it)) }
        }
        val total = HoraCronograma.duracion(AgendaDia.cubiertos(conFin))
        findViewById<TextView>(R.id.crono_dia_resumen).text = when (delDia.size) {
            0 -> getString(R.string.crono_vacio)
            1 -> getString(R.string.crono_resumen_dia_uno_fmt, total)
            else -> getString(R.string.crono_resumen_dia_fmt, delDia.size, total)
        }

        // Huecos sin registrar: hoy, desde el inicio de jornada hasta ahora;
        // días pasados, entre actividades; días futuros, ninguno (se planifica).
        val tramos = AgendaDia.tramosDelDia(delDia, { it.hora }, { it.horaFin })
        val huecos = when {
            esHoy -> AgendaDia.huecos(tramos, inicioJornadaHoy(), ahora)
            fecha < hoy -> AgendaDia.huecos(tramos, null, null)
            else -> emptyList()
        }
        val filas = mutableListOf<Fila>()
        delDia.forEach { filas += Fila.DeActividad(it, HoraCronograma.aMinutos(it.hora)) }
        huecos.forEach { filas += Fila.Hueco(it) }
        if (esHoy && enCurso == null) filas += Fila.Ahora(ahora)
        val orden = filas.sortedWith(compareBy({ if (it is Fila.Ahora) it.minuto + 0.5 else it.minuto.toDouble() }, { it.orden }))

        if (delDia.isEmpty() && huecos.isEmpty()) {
            lista.addView(TextView(this).apply {
                setText(R.string.crono_vacio)
                setTextColor(getColor(R.color.text_tertiary))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(dp(4), dp(18), 0, dp(8))
            })
        }
        orden.forEach { f ->
            when (f) {
                is Fila.DeActividad -> lista.addView(filaActividad(f.a, f.a == enCurso, esHoy, ahora, fecha < hoy))
                is Fila.Hueco -> lista.addView(filaHueco(f.tramo))
                is Fila.Ahora -> lista.addView(filaAhora(ahoraTexto))
            }
        }
        if (delDia.isEmpty()) atajosTodoElDia(lista)
    }

    /** Atajos: marcar el día entero sin escribir nada. */
    private fun atajosTodoElDia(lista: LinearLayout) {
        lista.addView(TextView(this).apply {
            setText(R.string.crono_todo_dia)
            setTextColor(getColor(R.color.text_secondary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setPadding(dp(4), dp(16), 0, dp(6))
        })
        val atajos = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, dp(14))
        }
        listOf(TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO).forEach { tipo ->
            atajos.addView(chip(tipo.etiqueta, false) {
                Actividades.guardar(
                    this,
                    Actividades.nueva(this, fechaDe(dia), hoy(), tipo, ActividadActivity.INICIO_DIA, ActividadActivity.FIN_DIA, null, null),
                )
                pintar()
            })
        }
        lista.addView(atajos)
    }

    private fun columnaHora(inicio: String, fin: String?, apagada: Boolean): TextView = TextView(this).apply {
        val principal = HoraCronograma.legible(inicio)
        val texto = android.text.SpannableStringBuilder(principal)
        if (fin != null) {
            val desde = texto.length
            texto.append("\n").append(HoraCronograma.legible(fin))
            texto.setSpan(android.text.style.RelativeSizeSpan(0.85f), desde, texto.length, 0)
            texto.setSpan(android.text.style.ForegroundColorSpan(getColor(R.color.text_tertiary)), desde, texto.length, 0)
        }
        text = texto
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(if (apagada) R.color.text_tertiary else R.color.text_primary))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        setLineSpacing(0f, 1.15f)
        layoutParams = LinearLayout.LayoutParams(dp(76), LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun filaActividad(a: Actividad, enCurso: Boolean, esHoy: Boolean, ahora: Int, diaPasado: Boolean): View {
        val fin = a.horaFin?.let { HoraCronograma.aMinutos(it) }
        val terminada = diaPasado || (esHoy && fin != null && fin <= ahora)
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(12), dp(4), dp(12))
            setBackgroundResource(android.R.drawable.list_selector_background)
            setOnClickListener { ActividadActivity.abrir(this@CronogramaActivity, a.fecha, a) }
        }
        fila.addView(columnaHora(a.hora, a.horaFin, terminada))
        val (color, fondo) = colorTipo(a.tipo)
        // Barra de color del tipo, a lo alto de la fila.
        fila.addView(View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(2).toFloat()
                setColor(getColor(color))
            }
            alpha = if (terminada) 0.45f else 1f
            layoutParams = LinearLayout.LayoutParams(dp(3), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(10) }
        })
        val texto = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val cabecera = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        cabecera.addView(TextView(this).apply {
            text = a.tipo.etiqueta
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(getColor(color))
            setBackgroundResource(fondo)
            setPadding(dp(8), dp(1), dp(8), dp(1))
        })
        if (!a.lugar.isNullOrBlank()) {
            cabecera.addView(TextView(this).apply {
                text = a.lugar
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(getColor(R.color.text_primary))
                setPadding(dp(8), 0, 0, 0)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
        }
        texto.addView(cabecera)
        if (!a.nota.isNullOrBlank()) {
            texto.addView(TextView(this).apply {
                text = a.nota
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                setTextColor(getColor(R.color.text_secondary))
                setPadding(0, dp(3), 0, 0)
            })
        }
        val estado = listOfNotNull(
            if (a.conUbicacion || (a.lat != null && a.pendiente)) getString(R.string.crono_con_ubicacion) else null,
            if (a.pendiente) getString(R.string.crono_pendiente) else null,
        ).joinToString(" · ")
        if (estado.isNotEmpty()) {
            texto.addView(TextView(this).apply {
                text = estado
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setTextColor(getColor(if (a.pendiente) R.color.warn else R.color.text_tertiary))
                setPadding(0, dp(3), 0, 0)
            })
        }
        if (enCurso) texto.addView(enCursoConTermine(a, ahora))
        fila.addView(texto)
        return fila
    }

    /** "En curso · termina 10:00 a. m." y "Terminé" para cerrarla a la hora real. */
    private fun enCursoConTermine(a: Actividad, ahora: Int): View {
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        fila.addView(TextView(this).apply {
            text = a.horaFin?.let { getString(R.string.crono_en_curso_fmt, HoraCronograma.legible(it)) } ?: getString(R.string.crono_en_curso)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(getColor(R.color.primary))
            setBackgroundResource(R.drawable.ds_chip_magenta)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) }
        })
        if (ahora > HoraCronograma.aMinutos(a.hora)) {
            fila.addView(TextView(this).apply {
                setText(R.string.crono_terminar_ahora)
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(getColor(R.color.primary))
                setBackgroundResource(R.drawable.ds_button_outline)
                setPadding(dp(14), 0, dp(14), 0)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(34))
                setOnClickListener {
                    val fin = HoraCronograma.deMinutos(minutosAhora())
                    if (HoraCronograma.aMinutos(fin) <= HoraCronograma.aMinutos(a.hora)) return@setOnClickListener
                    Actividades.guardar(this@CronogramaActivity, a.copy(horaFin = fin))
                    Toast.makeText(
                        this@CronogramaActivity,
                        getString(R.string.crono_terminada_fmt, a.tipo.etiqueta, HoraCronograma.legible(fin)),
                        Toast.LENGTH_SHORT,
                    ).show()
                    pintar()
                    Actividades.sincronizar(this@CronogramaActivity) { runOnUiThread { if (!isFinishing && !isDestroyed) pintar() } }
                }
            })
        }
        return fila
    }

    /** Hueco sin registrar: tocarlo abre el formulario con esas horas. */
    private fun filaHueco(t: AgendaDia.Tramo): View {
        val inicio = HoraCronograma.deMinutos(t.inicio)
        val fin = HoraCronograma.deMinutos(t.fin)
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.ds_hueco)
            setPadding(dp(4), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
                bottomMargin = dp(4)
            }
            setOnClickListener { ActividadActivity.abrir(this@CronogramaActivity, fechaDe(dia), null, inicio, fin) }
        }
        fila.addView(columnaHora(inicio, fin, true))
        fila.addView(TextView(this).apply {
            text = getString(R.string.crono_sin_registrar_fmt, HoraCronograma.duracion(t.minutos))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            setTextColor(getColor(R.color.text_secondary))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        fila.addView(TextView(this).apply {
            setText(R.string.crono_agregar_corto)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(getColor(R.color.primary))
        })
        return fila
    }

    /** Línea de la hora actual entre lo que ya pasó y lo que viene. */
    private fun filaAhora(hora: String): View {
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(6), 0, dp(6))
        }
        fila.addView(TextView(this).apply {
            text = getString(R.string.crono_ahora_fmt, HoraCronograma.legible(hora))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(getColor(R.color.primary))
            setPadding(dp(4), 0, dp(8), 0)
        })
        fila.addView(View(this).apply {
            setBackgroundColor(getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(0, dp(1), 1f)
        })
        return fila
    }

    private fun colorTipo(tipo: TipoActividad): Pair<Int, Int> = when (tipo) {
        TipoActividad.VISITA -> R.color.navy_700 to R.drawable.ds_chip_neutral
        TipoActividad.ALMUERZO -> R.color.warn to R.drawable.ds_chip_pending
        TipoActividad.PERMISO_MEDICO -> R.color.primary to R.drawable.ds_chip_danger
        TipoActividad.VACACIONES -> R.color.ok to R.drawable.ds_chip_ok
        TipoActividad.PERMISO -> R.color.navy_700 to R.drawable.ds_chip_neutral
        TipoActividad.NOVEDAD -> R.color.primary to R.drawable.ds_chip_magenta
    }

    private fun chip(texto: String, seleccionado: Boolean, alTocar: () -> Unit): TextView = TextView(this).apply {
        text = texto
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        setTypeface(typeface, Typeface.BOLD)
        setBackgroundResource(R.drawable.ds_chip_tipo)
        isSelected = seleccionado
        setTextColor(getColor(if (seleccionado) R.color.white else R.color.text_primary))
        setPadding(dp(6), dp(9), dp(6), dp(9))
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = dp(6)
        }
        setOnClickListener { alTocar() }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val KEY_EN_MES = "crono_en_mes"
        const val KEY_DIA = "crono_dia"
        const val KEY_MES = "crono_mes"
    }
}

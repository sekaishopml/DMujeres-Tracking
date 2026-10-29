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
import androidx.appcompat.app.AppCompatActivity
import com.dmujeres.app.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Cronograma de actividades.
 *
 * - Abre en HOY: la semana arriba (un punto marca los días con actividades) y
 *   el día sobre una regla de horas, con las actividades en su horario, los
 *   ratos sin registrar (desde el inicio de jornada hasta ahora) y la hora
 *   actual. La actividad en curso tiene "Finalizar" para cerrarla a la hora
 *   real.
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
        com.dmujeres.app.pantallas.Responsivo.raiz(this)?.let {
            com.dmujeres.app.pantallas.Responsivo.centrarHijos(it, com.dmujeres.app.pantallas.Responsivo.ANCHO_PANEL_DP)
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
            if (CierreDia.cerrado(fechaDe(dia))) {
                // El día cerrado se avisa en la lista (pintarDia).
                pintar()
                return@setOnClickListener
            }
            ActividadActivity.abrir(this, fechaDe(dia))
        }
        findViewById<View>(R.id.crono_reporte).setOnClickListener {
            startActivity(android.content.Intent(this, com.dmujeres.app.reporte.ReporteActivity::class.java))
        }
        cabeceraSemana()
        pintar()
        com.dmujeres.app.pantallas.Animaciones.respuestaAlToque(
            findViewById(R.id.crono_agregar), findViewById(R.id.crono_ir_hoy),
        )
        com.dmujeres.app.pantallas.Animaciones.alDesplazar(findViewById(R.id.crono_scroll), findViewById(R.id.crono_lista))
        if (savedInstanceState == null) {
            com.dmujeres.app.pantallas.Animaciones.entradaEscalonada(
                listOf(R.id.crono_semana, R.id.crono_dia_cab, R.id.crono_dia, R.id.crono_mes)
                    .mapNotNull { findViewById<View>(it) }.filter { it.visibility == View.VISIBLE },
                40, 80,
            )
        }
    }

    override fun onResume() {
        super.onResume()
        if (seguirHoy && fechaDe(dia) != hoy()) {
            dia = Calendar.getInstance(zona)
            mes = primeroDelMes(dia)
        }
        pintar()
        refrescarDelServidor()
        // Lista de clientes al día para proponerlos al registrar.
        Clientes.actualizar(this)
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

    // Con el dedo apoyado en la regla no se redibuja: la sincronización
    // terminaba justo entonces, cambiaba la regla y el toque se perdía.
    private var dedoEnRegla = false
    private var repintar = false

    private fun pintar() {
        if (dedoEnRegla) {
            repintar = true
            return
        }
        val titulo = findViewById<TextView>(R.id.crono_titulo)
        // Al pasar de mes a día (o al revés) lo que cambia se acomoda con suavidad.
        if ((findViewById<View>(R.id.crono_mes).visibility == View.VISIBLE) != enMes) {
            com.dmujeres.app.pantallas.Animaciones.suave(findViewById<View>(R.id.crono_modo).rootView as android.view.ViewGroup)
        }
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

    private class Parada(val parada: ParadaGps, val tramo: AgendaDia.Tramo)

    /**
     * El día como una lista simple, en orden de hora: una fila por actividad
     * (se toca para verla o cambiarla) y las paradas del GPS sin registrar.
     * Antes era una regla de 24 horas donde había que tocar inicio y fin o
     * arrastrar: el personal la encontraba difícil.
     */
    private fun pintarDia() {
        val lista = findViewById<LinearLayout>(R.id.crono_lista)
        lista.removeAllViews()
        val fecha = fechaDe(dia)
        val hoy = hoy()
        val esHoy = fecha == hoy
        val delDia = Actividades.delDia(this, fecha).sortedBy { HoraCronograma.aMinutos(it.hora) }
        val ahora = minutosAhora()
        val enCurso = if (esHoy) HoraCronograma.enCurso(delDia, HoraCronograma.deMinutos(ahora), { it.hora }, { it.horaFin }) else null

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
        findViewById<View>(R.id.crono_seleccion).visibility = View.GONE
        val cerrado = CierreDia.cerrado(fecha)
        val ayuda = findViewById<TextView>(R.id.crono_ayuda)
        ayuda.visibility = if (cerrado) View.VISIBLE else View.GONE
        if (cerrado) ayuda.setText(R.string.crono_dia_cerrado)

        val tramos = AgendaDia.tramosDelDia(delDia, { it.hora }, { it.horaFin })
        val paradas = if (fecha <= hoy && !cerrado) paradasSinRegistrar(fecha, tramos, if (esHoy) ahora else null) else emptyList()

        // Actividades y paradas, juntas y en orden de hora.
        val filas = delDia.map { HoraCronograma.aMinutos(it.hora) to filaActividad(it, it == enCurso, cerrado) } +
            paradas.map { p ->
                p.tramo.inicio to filaParada(p) {
                    ActividadActivity.abrir(
                        this, fecha, null, HoraCronograma.deMinutos(p.tramo.inicio), HoraCronograma.deMinutos(p.tramo.fin),
                        p.parada.lat, p.parada.lon,
                    )
                }
            }
        filas.sortedBy { it.first }.forEach { (_, fila) -> lista.addView(fila) }
        if (filas.isEmpty()) {
            lista.addView(TextView(this).apply {
                setText(if (cerrado) R.string.crono_dia_cerrado else R.string.crono_lista_vacia)
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setTextColor(getColor(R.color.text_secondary))
                setPadding(dp(16), dp(40), dp(16), dp(40))
            })
        }
    }

    /** Fila de una actividad: horas a la izquierda, color del tipo, lugar o nota y duración. */
    private fun filaActividad(a: Actividad, enCurso: Boolean, cerrado: Boolean): View {
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(if (enCurso) R.drawable.ds_tarjeta_marino else R.drawable.ds_surface)
            minimumHeight = dp(64)
            setPadding(dp(14), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = dp(8) }
            if (!cerrado) setOnClickListener { ActividadActivity.abrir(this@CronogramaActivity, a.fecha, a) }
        }
        val claro = getColor(R.color.white)
        val principal = if (enCurso) claro else getColor(R.color.text_primary)
        val secundario = if (enCurso) 0xFFC9D5E6.toInt() else getColor(R.color.text_secondary)
        val horas = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(dp(54), LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        horas.addView(TextView(this).apply {
            text = HoraCronograma.legible(a.hora)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(principal)
        })
        horas.addView(TextView(this).apply {
            text = a.horaFin?.let { HoraCronograma.legible(it) } ?: if (enCurso) getString(R.string.crono_ahora) else "—"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(secundario)
        })
        fila.addView(horas)
        fila.addView(View(this).apply {
            setBackgroundColor(getColor(if (enCurso) R.color.primary else a.tipo.color()))
            layoutParams = LinearLayout.LayoutParams(dp(4), dp(40)).apply { marginEnd = dp(12) }
        })
        val textos = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        textos.addView(TextView(this).apply {
            text = a.lugar ?: a.nota ?: a.tipo.etiqueta
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(principal)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        val duracion = a.horaFin?.let { HoraCronograma.duracion(HoraCronograma.aMinutos(it) - HoraCronograma.aMinutos(a.hora)) }
        textos.addView(TextView(this).apply {
            text = listOfNotNull(a.tipo.etiqueta, if (enCurso) getString(R.string.crono_en_curso_corto) else duracion).joinToString(" · ")
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(secundario)
            maxLines = 1
        })
        fila.addView(textos)
        if (!cerrado) {
            fila.addView(android.widget.ImageView(this).apply {
                setImageResource(R.drawable.ds_ic_chevron)
                setColorFilter(secundario)
                layoutParams = LinearLayout.LayoutParams(dp(18), dp(18))
            })
        }
        com.dmujeres.app.pantallas.Animaciones.respuestaAlToque(fila)
        return fila
    }

    /** Parada del GPS sin actividad: fila punteada con "Registrar". */
    private fun filaParada(p: Parada, alTocar: () -> Unit): View {
        val t = p.tramo
        return bloqueSinRegistrar(
            getString(
                R.string.crono_parada_fila_fmt,
                HoraCronograma.deMinutos(t.inicio), HoraCronograma.deMinutos(t.fin), HoraCronograma.duracion(t.minutos),
            ),
            R.string.crono_registrar_corto, alTocar,
        ).apply {
            minimumHeight = dp(52)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = dp(8) }
        }
    }

    /** Rato sin registrar o parada del GPS: punteado, se toca para registrarlo. */
    private fun bloqueSinRegistrar(texto: String, accion: Int, alTocar: () -> Unit): View {
        val caja = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.ds_hueco)
            setPadding(dp(10), 0, dp(10), 0)
            setOnClickListener { alTocar() }
        }
        caja.addView(TextView(this).apply {
            text = texto
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(getColor(R.color.text_secondary))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        caja.addView(TextView(this).apply {
            setText(accion)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(getColor(R.color.primary))
        })
        return caja
    }

    /**
     * Paradas del día que no tienen actividad. Se piden al servidor una vez y
     * la lista se vuelve a pintar solo si llegaron distintas.
     */
    private fun paradasSinRegistrar(fecha: String, tramos: List<AgendaDia.Tramo>, hastaMinuto: Int?): List<Parada> {
        val antes = ParadasDia.guardadas(fecha)
        ParadasDia.cargar(this, fecha) { nuevas ->
            if (nuevas != antes) runOnUiThread { if (!isFinishing && fechaDe(dia) == fecha) pintarDia() }
        }
        return ParadasDia.sinCubrir(fecha, tramos)
            .filter { (_, t) -> hastaMinuto == null || t.inicio <= hastaMinuto }
            .map { (p, t) -> Parada(p, t) }
    }

    private fun colorTipo(tipo: TipoActividad): Pair<Int, Int> = tipo.color() to when (tipo) {
        TipoActividad.VISITA, TipoActividad.PERMISO -> R.drawable.ds_chip_neutral
        TipoActividad.ALMUERZO -> R.drawable.ds_chip_pending
        TipoActividad.PERMISO_MEDICO -> R.drawable.ds_chip_danger
        TipoActividad.VACACIONES -> R.drawable.ds_chip_ok
        TipoActividad.NOVEDAD -> R.drawable.ds_chip_magenta
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val KEY_EN_MES = "crono_en_mes"
        const val KEY_DIA = "crono_dia"
        const val KEY_MES = "crono_mes"
    }
}

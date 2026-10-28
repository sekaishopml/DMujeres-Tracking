package com.dmujeres.app.cronograma

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.graphics.Rect
import android.view.Gravity
import android.view.MotionEvent
import kotlin.math.abs
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.dmujeres.app.R
import com.dmujeres.app.pantallas.Animaciones
import com.dmujeres.app.pantallas.Responsivo
import com.dmujeres.app.cronograma.AgendaDia.Cruce
import com.dmujeres.app.cronograma.AgendaDia.Tramo
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Agregar o editar una actividad del cronograma, en pantalla completa.
 *
 * - Nueva de hoy: se elige entre iniciarla ahora o programarla con horario.
 *   Con una actividad en curso se propone programarla, para no cerrar la que
 *   está en marcha; iniciar otra ahora la finaliza, y se avisa antes.
 * - Sin hora de fin, la actividad dura hasta finalizarla o hasta la
 *   siguiente. Desde un hueco del día llegan sus horas.
 * - La pantalla va por preguntas (qué, cuándo, dónde, nota) y propone lo que
 *   puede: el primer rato libre, las paradas del GPS sin actividad, la
 *   duración a un toque, el cliente cercano y las notas ya usadas. Sobre el
 *   botón se lee siempre lo que se va a guardar o lo que falta.
 * - Las horas se muestran en 24 h. Una hora completa ("08:30", "1400") se
 *   toma tal cual; una corta ("9", "2:30") se deduce como en una jornada
 *   ("de 11 a 2" es de 11:00 a 14:00).
 * - Si Hasta tiene hora y no se tocó, acompaña a Desde con la misma duración.
 * - Tocar fuera de un campo termina de editarlo y cierra el teclado.
 * - Si se cruza con otra actividad, se ve antes de guardar cómo se acomoda la
 *   vecina (AgendaDia) y se ofrece mover esta en su lugar.
 */
class ActividadActivity : AppCompatActivity() {

    private val zona = TimeZone.getTimeZone("America/Guayaquil")
    private val iso = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }
    private val es = Locale("es", "EC")

    private lateinit var fecha: String
    private var existente: Actividad? = null
    // Parada del GPS desde la que se registra (o la guardada al editar).
    private var paradaLat: Double? = null
    private var paradaLon: Double? = null
    private var tipo = TipoActividad.VISITA
    private lateinit var desde: CampoHora
    private lateinit var hasta: CampoHora
    private var duracion = 60
    private var cambios = false
    private var ajustes: List<AgendaDia.Ajuste<Actividad>> = emptyList()
    // Nueva de hoy que empieza en este momento (sin escribir horas).
    private var modoAhora = false
    // La actividad iniciada y sin finalizar, y si guardar esta la finaliza.
    private var enCurso: Actividad? = null
    private var cierreEnCurso: Actividad? = null
    private val fichas = mutableMapOf<TipoActividad, View>()
    // Botones de duración: minutos de cada uno (TODO_EL_DIA para el día de trabajo completo).
    private val duraciones = mutableListOf<Pair<Int, TextView>>()
    // Dónde está la persona al registrar (parada elegida o último punto): ordena los clientes cercanos.

    private lateinit var lugar: android.widget.EditText
    private lateinit var nota: EditText
    private lateinit var error: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_actividad)
        Responsivo.raiz(this)?.let { Responsivo.centrarHijos(it, Responsivo.ANCHO_PANEL_DP) }
        val contenido = findViewById<ViewGroup>(R.id.act_contenido)
        if (savedInstanceState == null) {
            Animaciones.entradaEscalonada((0 until contenido.childCount).map { contenido.getChildAt(it) }, 40, 60)
        }
        Animaciones.respuestaAlToque(
            findViewById(R.id.act_guardar), findViewById(R.id.act_modo_ahora), findViewById(R.id.act_modo_programar),
        )

        fecha = intent.getStringExtra(EXTRA_FECHA) ?: hoy()
        existente = intent.getStringExtra(EXTRA_ID)?.let { id ->
            Actividades.todas(this).firstOrNull { it.clientId == id && !it.eliminada }
        }
        val actual = existente
        paradaLat = intent.getDoubleExtra(EXTRA_LAT, Double.NaN).takeIf { !it.isNaN() } ?: actual?.lugarLat
        paradaLon = intent.getDoubleExtra(EXTRA_LON, Double.NaN).takeIf { !it.isNaN() } ?: actual?.lugarLon
        lugar = findViewById(R.id.act_lugar)
        nota = findViewById(R.id.act_nota)
        error = findViewById(R.id.act_error)

        findViewById<TextView>(R.id.act_titulo).setText(if (actual == null) R.string.crono_nueva else R.string.crono_editar)
        findViewById<TextView>(R.id.act_fecha).text = fechaLegible()
        findViewById<View>(R.id.act_volver).setOnClickListener { salir() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = salir()
        })

        desde = CampoHora(R.id.act_desde, { null }) { alCambiarDesde() }
        hasta = CampoHora(R.id.act_hasta, {
            desde.leer()?.let { HoraCronograma.aMinutos(it) }
        }) { alCambiarHasta() }

        tipo = savedInstanceState?.getString(KEY_TIPO)?.let { TipoActividad.de(it) } ?: actual?.tipo ?: TipoActividad.VISITA
        val nuevaDeHoy = actual == null && fecha == hoy()
        modoAhora = savedInstanceState?.getBoolean(KEY_MODO_AHORA)
            ?: (nuevaDeHoy && intent.getStringExtra(EXTRA_DESDE) == null && abiertaEnCurso() == null)
        findViewById<View>(R.id.act_modo).visibility = if (nuevaDeHoy) View.VISIBLE else View.GONE
        findViewById<View>(R.id.act_modo_ahora).setOnClickListener { ponerModo(true) }
        findViewById<View>(R.id.act_modo_programar).setOnClickListener { ponerModo(false) }
        val (inicio, fin) = horasIniciales(actual, savedInstanceState)
        desde.poner(inicio)
        hasta.poner(fin)
        duracion = fin?.let { HoraCronograma.aMinutos(it) - HoraCronograma.aMinutos(inicio) }?.takeIf { it > 0 }
            ?: duracionInicial(tipo)
        if (savedInstanceState != null) {
            desde.tocado = savedInstanceState.getBoolean(KEY_DESDE_TOCADO)
            hasta.tocado = savedInstanceState.getBoolean(KEY_HASTA_TOCADO)
            cambios = savedInstanceState.getBoolean(KEY_CAMBIOS)
        } else {
            lugar.setText(actual?.lugar.orEmpty())
            nota.setText(actual?.nota.orEmpty())
        }

        armarTipos()
        armarDuraciones()
        val alEscribir = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                cambios = true
                error.visibility = View.GONE
                pintarResumen()
            }
        }
        lugar.addTextChangedListener(alEscribir)
        nota.addTextChangedListener(alEscribir)

        findViewById<View>(R.id.act_eliminar).apply {
            visibility = if (actual != null) View.VISIBLE else View.GONE
            setOnClickListener { confirmarEliminar() }
        }
        findViewById<View>(R.id.act_guardar).setOnClickListener { guardar() }
        aplicarTipo()
        refrescar()
        // Paradas del GPS de ese día: se ofrecen como horario a un toque.
        if (actual == null && fecha <= hoy()) {
            ParadasDia.cargar(this, fecha) { runOnUiThread { if (!isFinishing && !isDestroyed) refrescar() } }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(KEY_TIPO, tipo.codigo)
        desde.leer()?.let { outState.putString(KEY_DESDE, it) }
        hasta.leer()?.let { outState.putString(KEY_HASTA, it) }
        outState.putBoolean(KEY_DESDE_TOCADO, desde.tocado)
        outState.putBoolean(KEY_HASTA_TOCADO, hasta.tocado)
        outState.putBoolean(KEY_CAMBIOS, cambios)
        outState.putBoolean(KEY_MODO_AHORA, modoAhora)
    }

    /** Al tocar fuera del campo que se está editando, se termina de editar. */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN) {
            val campo = currentFocus
            if (campo is EditText) {
                val r = Rect()
                campo.getGlobalVisibleRect(r)
                if (!r.contains(ev.rawX.toInt(), ev.rawY.toInt())) terminarEdicion(campo)
            }
            // Tocar fuera de la rueda y de sus campos la cierra.
            val rueda = findViewById<RuedaHora>(R.id.act_rueda)
            if (rueda.visibility == View.VISIBLE && !tocaRueda(ev)) cerrarRueda()
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun tocaRueda(ev: MotionEvent): Boolean =
        listOf(R.id.act_rueda, R.id.act_desde, R.id.act_hasta).any { id ->
            val r = Rect()
            findViewById<View>(id).getGlobalVisibleRect(r)
            r.contains(ev.rawX.toInt(), ev.rawY.toInt())
        }

    private fun cerrarRueda() {
        val rueda = findViewById<RuedaHora>(R.id.act_rueda)
        rueda.alCambiar = null
        rueda.visibility = View.GONE
    }

    private fun terminarEdicion(campo: View) {
        findViewById<View>(R.id.act_contenido).requestFocus()
        getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(campo.windowToken, 0)
    }

    // ── Datos de partida ───────────────────────────────────────────────────

    private fun hoy(): String = iso.format(Calendar.getInstance(zona).time)

    private fun horaActual(): String {
        val c = Calendar.getInstance(zona)
        return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    }

    private fun delDiaSinEsta(): List<Actividad> =
        Actividades.delDia(this, fecha).filter { it.clientId != existente?.clientId }

    private fun horasIniciales(actual: Actividad?, estado: Bundle?): Pair<String, String?> {
        val guardadoDesde = estado?.getString(KEY_DESDE)
        if (guardadoDesde != null) return guardadoDesde to estado.getString(KEY_HASTA)
        if (actual != null) return actual.hora to actual.horaFin
        val pedidoDesde = intent.getStringExtra(EXTRA_DESDE)
        val pedidoHasta = intent.getStringExtra(EXTRA_HASTA)
        if (pedidoDesde != null && pedidoHasta != null) return pedidoDesde to pedidoHasta
        // Sin empezarla ahora, se propone el primer rato libre.
        if (!modoAhora) return horarioSugerido(duracionInicial(tipo))
        return horaActual() to null
    }

    /**
     * Primer rato libre donde cabe la actividad, desde que termina la última
     * del día (así la siguiente se programa sin buscar la hora). Una sin fin
     * cuenta hasta ahora si es de hoy. Sin actividades: hoy, la próxima media
     * hora; otro día, el inicio del día de trabajo.
     */
    private fun horarioSugerido(minutos: Int): Pair<String, String> {
        val esHoy = fecha == hoy()
        val ahora = HoraCronograma.aMinutos(horaActual())
        val ultimoFin = delDiaSinEsta().maxOfOrNull { a ->
            a.horaFin?.let { HoraCronograma.aMinutos(it) }
                ?: if (esHoy) maxOf(ahora, HoraCronograma.aMinutos(a.hora)) else HoraCronograma.aMinutos(a.hora)
        }
        val base = ultimoFin ?: if (esHoy) (ahora / 30 + 1) * 30 else HoraCronograma.aMinutos(INICIO_DIA)
        val inicio = AgendaDia.proximoLibre(delDiaSinEsta().mapNotNull(::tramoDe), base, minutos) ?: base
        return HoraCronograma.deMinutos(inicio) to HoraCronograma.deMinutos(inicio + minutos)
    }

    /** La actividad de hoy iniciada y sin finalizar (distinta de la que se edita). */
    private fun abiertaEnCurso(): Actividad? {
        if (fecha != hoy()) return null
        return HoraCronograma.enCurso(Actividades.delDia(this, fecha), horaActual(), { it.hora }, { it.horaFin })
            ?.takeIf { it.horaFin == null && it.clientId != existente?.clientId }
    }

    private fun ponerModo(ahora: Boolean) {
        if (modoAhora == ahora) return
        modoAhora = ahora
        cambios = true
        // Al pasar a programar sin haber escrito horas se propone el primer rato libre.
        if (!ahora && !desde.tocado && !hasta.tocado) {
            duracion = duracionInicial(tipo)
            val (d, h) = horarioSugerido(duracion)
            desde.poner(d)
            hasta.poner(h)
        }
        findViewById<View>(if (ahora) R.id.act_modo_ahora else R.id.act_modo_programar)?.let { Animaciones.pulso(it, 1.05f) }
        refrescar()
    }

    private fun fechaLegible(): String {
        val c = Calendar.getInstance(zona).apply { time = iso.parse(fecha) ?: time }
        val texto = SimpleDateFormat("EEEE d 'de' MMMM", es).apply { timeZone = zona }.format(c.time)
        val hoy = Calendar.getInstance(zona)
        val diferencia = ((iso.parse(fecha)?.time ?: 0L) - (iso.parse(iso.format(hoy.time))?.time ?: 0L)) / 86_400_000L
        val prefijo = when (diferencia) {
            0L -> getString(R.string.crono_hoy)
            -1L -> getString(R.string.crono_ayer)
            1L -> getString(R.string.crono_manana)
            else -> null
        }
        return if (prefijo != null) "$prefijo · $texto" else texto.replaceFirstChar { it.uppercase() }
    }

    // ── Tipo y lugar ───────────────────────────────────────────────────────

    /** Tres fichas por fila con el color del tipo; debajo se lee para qué sirve la elegida. */
    private fun armarTipos() {
        val caja = findViewById<LinearLayout>(R.id.act_tipos)
        ORDEN_TIPOS.chunked(3).forEachIndexed { f, grupo ->
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                isBaselineAligned = false
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { if (f > 0) topMargin = dp(6) }
            }
            grupo.forEachIndexed { c, t ->
                val ficha = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                    setPadding(dp(6), 0, dp(6), 0)
                    layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply { if (c < grupo.size - 1) marginEnd = dp(6) }
                    setOnClickListener { elegirTipo(t) }
                }
                ficha.addView(TextView(this).apply {
                    text = t.etiqueta
                    maxLines = 2
                    gravity = Gravity.CENTER
                    textAlignment = View.TEXT_ALIGNMENT_CENTER
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                })
                fichas[t] = ficha
                fila.addView(ficha)
            }
            caja.addView(fila)
        }
    }

    private fun elegirTipo(t: TipoActividad) {
        if (tipo == t) {
            plegarTipos(true)
            return
        }
        tipo = t
        cambios = true
        plegarTipos(true)
        // Vacaciones es el día entero (si las horas no se tocaron).
        if (t == TipoActividad.VACACIONES && !desde.tocado && !hasta.tocado) {
            modoAhora = false
            desde.poner(INICIO_DIA)
            hasta.poner(FIN_DIA)
            duracion = HoraCronograma.aMinutos(FIN_DIA) - HoraCronograma.aMinutos(INICIO_DIA)
        }
        aplicarTipo()
        fichas[t]?.let { Animaciones.pulso(it, 1.04f) }
        refrescar()
    }

    // Ya elegido el tipo, la lista se pliega a una sola ficha con "Cambiar".
    private var tiposPlegados = false

    private fun plegarTipos(plegar: Boolean) {
        tiposPlegados = plegar
        findViewById<View>(R.id.act_tipos).visibility = if (plegar) View.GONE else View.VISIBLE
        val elegido = findViewById<View>(R.id.act_tipo_elegido)
        elegido.visibility = if (plegar) View.VISIBLE else View.GONE
        if (plegar) {
            findViewById<TextView>(R.id.act_tipo_elegido_nombre).apply {
                text = tipo.etiqueta
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(12).toFloat()
                    setColor(getColor(tipo.color()))
                }
                setTextColor(getColor(R.color.white))
            }
            findViewById<TextView>(R.id.act_tipo_cambiar).setOnClickListener { plegarTipos(false) }
        }
    }

    private fun aplicarTipo() {
        fichas.forEach { (t, v) ->
            val elegido = t == tipo
            // La elegida se llena con su color: se ve de un vistazo cuál quedó.
            v.background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(getColor(if (elegido) t.color() else R.color.surface))
                setStroke(dp(1), getColor(if (elegido) t.color() else R.color.line))
            }
            ((v as? android.view.ViewGroup)?.getChildAt(0) as? TextView)?.setTextColor(getColor(if (elegido) R.color.white else R.color.text_primary))
        }
        Animaciones.texto(
            findViewById(R.id.act_tipo_ayuda),
            resources.getStringArray(R.array.crono_tipos_ayuda)[ORDEN_TIPOS.indexOf(tipo)],
        )
        val conLugar = tipo == TipoActividad.VISITA || tipo == TipoActividad.NOVEDAD
        findViewById<View>(R.id.act_lugar_card).visibility = if (conLugar) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.act_nota_label).setText(
            if (tipo == TipoActividad.NOVEDAD) R.string.crono_nota_obligatoria else R.string.crono_nota,
        )
        pintarNotas()
    }

    /** Botón pequeño de una fila de propuestas (lugares, horarios, notas). */
    private fun chipRapido(texto: String, destacado: Boolean = false, alTocar: () -> Unit): TextView = TextView(this).apply {
        text = texto
        gravity = Gravity.CENTER
        maxLines = 1
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        setTextColor(getColor(if (destacado) R.color.primary else R.color.text_primary))
        if (destacado) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setBackgroundResource(if (destacado) R.drawable.ds_button_outline else R.drawable.ds_chip_tipo)
        setPadding(dp(12), 0, dp(12), 0)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(34)).apply {
            marginEnd = dp(6)
        }
        setOnClickListener { alTocar() }
    }

    /** Notas que la persona ya usó en este tipo de actividad, a un toque. */
    private fun pintarNotas() {
        val fila = findViewById<LinearLayout>(R.id.act_notas)
        fila.removeAllViews()
        Actividades.notasFrecuentes(this, tipo).forEach { texto ->
            fila.addView(chipRapido(texto) {
                nota.setText(texto)
                nota.setSelection(texto.length)
            })
        }
        findViewById<View>(R.id.act_notas_scroll).visibility = if (fila.childCount == 0) View.GONE else View.VISIBLE
    }

    // ── Horario ────────────────────────────────────────────────────────────

    private fun armarDuraciones() {
        val fila = findViewById<LinearLayout>(R.id.act_duraciones)
        // Solo queda "Todo el día", para permisos y vacaciones.
        listOf(TODO_EL_DIA).forEach { minutos ->
            val v = TextView(this).apply {
                text = if (minutos == TODO_EL_DIA) getString(R.string.crono_todo_el_dia) else HoraCronograma.duracion(minutos)
                gravity = Gravity.CENTER
                maxLines = 1
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setBackgroundResource(R.drawable.ds_chip_tipo)
                layoutParams = LinearLayout.LayoutParams(0, dp(36), 1f).apply { if (duraciones.isNotEmpty()) marginStart = dp(6) }
                setOnClickListener { ponerDuracion(minutos) }
            }
            duraciones += minutos to v
            fila.addView(v)
        }
    }

    private fun ponerDuracion(minutos: Int) {
        if (minutos == TODO_EL_DIA) {
            ponerHorario(INICIO_DIA, FIN_DIA)
            return
        }
        val d = desde.leer() ?: return mostrarError(R.string.crono_error_hora, findViewById(R.id.act_horario))
        duracion = minutos
        hasta.poner(HoraCronograma.sumar(d, minutos))
        // Hasta sigue acompañando a Desde si después se cambia la hora de inicio.
        hasta.tocado = false
        cambios = true
        refrescar()
    }

    private fun ponerHorario(d: String, h: String) {
        desde.poner(d)
        hasta.poner(h)
        desde.tocado = true
        hasta.tocado = true
        duracion = HoraCronograma.aMinutos(h) - HoraCronograma.aMinutos(d)
        cambios = true
        refrescar()
    }

    /** Marca la duración que coincide con las horas escritas; "Todo el día" solo en ausencias. */
    private fun pintarDuraciones(tramo: Tramo?) {
        val todoElDia = desde.leer() == INICIO_DIA && hasta.leer() == FIN_DIA
        duraciones.forEach { (minutos, v) ->
            val elegido = if (minutos == TODO_EL_DIA) todoElDia else !todoElDia && tramo?.minutos == minutos
            v.visibility = if (minutos == TODO_EL_DIA && tipo !in AUSENCIAS) View.GONE else View.VISIBLE
            v.isSelected = elegido
            v.setTextColor(getColor(if (elegido) R.color.white else R.color.text_primary))
        }
    }

    /**
     * Horarios que la app propone a un toque al agregar: el primer rato libre
     * y las paradas del GPS de ese día que todavía no tienen actividad (traen
     * también dónde fue, para proponer el cliente).
     */
    private fun pintarSugerencias(tramo: Tramo?) {
        val fila = findViewById<LinearLayout>(R.id.act_sugerencias)
        val habia = fila.childCount > 0
        fila.removeAllViews()
        if (existente == null && !modoAhora) {
            if (fecha <= hoy()) {
                val ocupados = AgendaDia.tramosDelDia(delDiaSinEsta(), { it.hora }, { it.horaFin })
                // Sin propuestas de "última parada": el horario se elige con la rueda.
                ParadasDia.sinCubrir(fecha, ocupados)
            }
        }
        Animaciones.mostrar(findViewById(R.id.act_contenido), findViewById(R.id.act_sugerencias_scroll), fila.childCount > 0)
        // Las propuestas aparecen una tras otra; si ya estaban, solo se rehacen.
        if (!habia && fila.childCount > 0) {
            Animaciones.entradaEscalonada((0 until fila.childCount).map { fila.getChildAt(it) }, 80, 70)
        }
    }

    private fun alCambiarDesde() {
        cambios = true
        val d = desde.leer()
        // Si Hasta tiene hora y no se tocó, acompaña a Desde con la misma duración.
        if (d != null && !hasta.tocado && hasta.leer() != null) hasta.poner(HoraCronograma.sumar(d, duracion))
        refrescar()
    }

    private fun alCambiarHasta() {
        cambios = true
        val d = desde.leer()?.let { HoraCronograma.aMinutos(it) }
        val h = hasta.leer()?.let { HoraCronograma.aMinutos(it) }
        if (d != null && h != null && h > d) duracion = h - d
        refrescar()
    }

    private fun tramoElegido(): Tramo? {
        val d = desde.leer() ?: return null
        val h = hasta.leer() ?: return null
        return Tramo(HoraCronograma.aMinutos(d), HoraCronograma.aMinutos(h)).takeIf { it.fin > it.inicio }
    }

    // La que está en curso cuenta desde que empezó hasta ahora; las demás sin
    // hora de fin no entran (no se sabe cuánto duraron).
    private fun tramoDe(a: Actividad): Tramo? = a.horaFin?.let {
        Tramo(HoraCronograma.aMinutos(a.hora), HoraCronograma.aMinutos(it)).takeIf { t -> t.fin > t.inicio }
    } ?: if (a.clientId == enCurso?.clientId) {
        AgendaDia.tramoEnCurso(HoraCronograma.aMinutos(a.hora), HoraCronograma.aMinutos(horaActual()))
    } else {
        null
    }

    private fun refrescar() {
        error.visibility = View.GONE
        enCurso = abiertaEnCurso()
        mapOf(R.id.act_modo_ahora to modoAhora, R.id.act_modo_programar to !modoAhora).forEach { (id, elegido) ->
            findViewById<TextView>(id).apply {
                isSelected = elegido
                setTextColor(getColor(if (elegido) R.color.white else R.color.text_primary))
            }
        }
        Animaciones.mostrar(findViewById(R.id.act_contenido), findViewById(R.id.act_horas), !modoAhora)
        val d = if (modoAhora) horaActual() else desde.leer()
        val h = if (modoAhora) null else hasta.leer()
        findViewById<TextView>(R.id.act_guardar).setText(if (modoAhora) R.string.crono_iniciar else R.string.crono_guardar)
        val tramo = if (modoAhora) null else tramoElegido()
        pintarResumen()
        pintarDuraciones(tramo)
        pintarSugerencias(tramo)
        ajustes = if (tramo != null) AgendaDia.ajustes(delDiaSinEsta(), tramo, ::tramoDe) else emptyList()
        // Nueva sin hora de fin que ya empezó: pasa a ser la que está en curso
        // y la anterior se finaliza a esa hora (se avisa antes de guardar).
        val empiezaYa = existente == null && d != null && h == null && (modoAhora || hasta.vacio()) &&
            HoraCronograma.aMinutos(d) <= HoraCronograma.aMinutos(horaActual())
        cierreEnCurso = enCurso?.takeIf { empiezaYa }
        pintarCruce(tramo, d)
    }

    /**
     * Lo que se va a guardar, en una frase, siempre a la vista sobre el botón;
     * o lo que falta para poder guardar.
     */
    private fun pintarResumen() {
        val resumen = findViewById<TextView>(R.id.act_resumen)
        val d = if (modoAhora) horaActual() else desde.leer()
        val h = if (modoAhora) null else hasta.leer()
        val conLugar = tipo == TipoActividad.VISITA || tipo == TipoActividad.NOVEDAD
        val sitio = lugar.text.toString().trim().takeIf { it.isNotEmpty() && conLugar }
        val falta = when {
            d == null || (!modoAhora && h == null && !hasta.vacio()) -> R.string.crono_resumen_falta
            h != null && HoraCronograma.aMinutos(h) <= HoraCronograma.aMinutos(d) -> R.string.crono_error_rango_noche
            tipo == TipoActividad.VISITA && sitio == null -> R.string.crono_falta_lugar
            tipo == TipoActividad.NOVEDAD && nota.text.isNullOrBlank() -> R.string.crono_falta_nota
            else -> null
        }
        if (falta != null || d == null) {
            resumen.setText(falta ?: R.string.crono_resumen_falta)
            resumen.setTextColor(getColor(R.color.warn))
            return
        }
        val que = listOfNotNull(tipo.etiqueta, sitio).joinToString(" · ")
        resumen.text = when {
            modoAhora -> getString(R.string.crono_resumen_ahora_fmt, que, HoraCronograma.legible(d))
            h == null -> getString(R.string.crono_resumen_abierta_fmt, que, HoraCronograma.legible(d))
            else -> getString(
                R.string.crono_resumen_rango_fmt, que, HoraCronograma.rango(d, h),
                HoraCronograma.duracion(HoraCronograma.aMinutos(h) - HoraCronograma.aMinutos(d)),
            )
        }
        resumen.setTextColor(getColor(R.color.text_primary))
    }

    private fun nombre(a: Actividad): String =
        listOfNotNull(a.tipo.etiqueta, a.lugar?.takeIf { it.isNotBlank() }).joinToString(" · ")

    private fun conRango(a: Actividad, t: Tramo): String = "${nombre(a)} (${rangoDe(t)})"

    /** Nombre con su horario; la que está en curso no tiene hora de fin. */
    private fun conHorario(aj: AgendaDia.Ajuste<Actividad>): String =
        if (aj.actividad.horaFin == null) {
            getString(R.string.crono_nombre_en_curso_fmt, nombre(aj.actividad), HoraCronograma.legible(aj.actividad.hora))
        } else {
            conRango(aj.actividad, aj.antes)
        }

    private fun rangoDe(t: Tramo): String =
        HoraCronograma.rangoCorto(HoraCronograma.deMinutos(t.inicio), HoraCronograma.deMinutos(t.fin))

    private fun pintarCruce(tramo: Tramo?, desdeHora: String?) {
        val caja = findViewById<View>(R.id.act_cruce)
        val raiz = findViewById<ViewGroup>(R.id.act_contenido)
        val titulo = findViewById<TextView>(R.id.act_cruce_titulo)
        val texto = findViewById<TextView>(R.id.act_cruce_texto)
        val accion = findViewById<TextView>(R.id.act_cruce_accion)
        val cierre = cierreEnCurso
        if (cierre != null && desdeHora != null) {
            Animaciones.mostrar(raiz, caja, true)
            accion.visibility = View.GONE
            titulo.setText(R.string.crono_en_curso_titulo)
            texto.text = if (HoraCronograma.aMinutos(desdeHora) > HoraCronograma.aMinutos(cierre.hora)) {
                getString(R.string.crono_en_curso_cierra_fmt, nombre(cierre), HoraCronograma.legible(cierre.hora), HoraCronograma.legible(desdeHora))
            } else {
                getString(R.string.crono_en_curso_antes_fmt, nombre(cierre), HoraCronograma.legible(cierre.hora))
            }
            return
        }
        if (ajustes.isEmpty() || tramo == null) {
            Animaciones.mostrar(raiz, caja, false)
            return
        }
        Animaciones.mostrar(raiz, caja, true)
        val tapadas = ajustes.filter { it.cruce == Cruce.CUBIERTA }
        val lineas = ajustes.map { aj ->
            val n = conHorario(aj)
            val abierta = aj.actividad.horaFin == null
            when (aj.cruce) {
                Cruce.RECORTAR_FIN -> getString(R.string.crono_cruce_recorta_fmt, n, HoraCronograma.legible(HoraCronograma.deMinutos(aj.tramos[0].fin)))
                Cruce.CORRER_INICIO -> getString(R.string.crono_cruce_corre_fmt, n, HoraCronograma.legible(HoraCronograma.deMinutos(aj.tramos[0].inicio)))
                Cruce.DIVIDIR -> if (abierta) {
                    getString(R.string.crono_cruce_divide_en_curso_fmt, n, rangoDe(aj.tramos[0]), HoraCronograma.legible(HoraCronograma.deMinutos(aj.tramos[1].inicio)))
                } else {
                    getString(R.string.crono_cruce_divide_fmt, n, rangoDe(aj.tramos[0]), rangoDe(aj.tramos[1]))
                }
                Cruce.CUBIERTA -> if (abierta) {
                    getString(R.string.crono_cruce_cubre_en_curso_fmt, n)
                } else {
                    getString(R.string.crono_cruce_cubre_fmt, nombre(aj.actividad), rangoDe(aj.antes))
                }
            }
        }
        if (tapadas.isNotEmpty()) {
            titulo.setText(R.string.crono_cruce_titulo)
            texto.text = (lineas + getString(R.string.crono_cruce_cubre_ayuda)).joinToString("\n")
            val primera = tapadas.first().actividad
            accion.text = getString(R.string.crono_cruce_eliminar_fmt, nombre(primera))
            accion.visibility = View.VISIBLE
            accion.setOnClickListener { confirmarEliminarVecina(primera) }
            return
        }
        titulo.text = "${getString(R.string.crono_cruce_titulo)}. ${getString(R.string.crono_cruce_al_guardar)}"
        texto.text = lineas.joinToString("\n")
        val otra = AgendaDia.alternativa(ajustes, tramo)
        if (otra == null) {
            accion.visibility = View.GONE
            return
        }
        accion.text = getString(R.string.crono_cruce_mover_fmt, rangoDe(otra))
        accion.visibility = View.VISIBLE
        accion.setOnClickListener {
            desde.poner(HoraCronograma.deMinutos(otra.inicio))
            hasta.poner(HoraCronograma.deMinutos(otra.fin))
            desde.tocado = true
            hasta.tocado = true
            duracion = otra.minutos
            cambios = true
            refrescar()
        }
    }

    // ── Guardar, eliminar, salir ───────────────────────────────────────────

    private fun mostrarError(texto: Int, vista: View? = null) {
        error.setText(texto)
        error.visibility = View.VISIBLE
        vista?.let { v -> findViewById<ScrollView>(R.id.act_scroll).post { findViewById<ScrollView>(R.id.act_scroll).smoothScrollTo(0, v.top) } }
    }

    private fun guardar() {
        // El día pudo cerrarse con la pantalla abierta.
        if (CierreDia.cerrado(fecha)) return mostrarError(R.string.crono_dia_cerrado)
        if (!modoAhora) {
            desde.normalizar()
            hasta.normalizar()
        }
        refrescar()
        val conLugar = tipo == TipoActividad.VISITA || tipo == TipoActividad.NOVEDAD
        val textoLugar = lugar.text.toString().trim().takeIf { it.isNotEmpty() && conLugar }
        val textoNota = nota.text.toString().trim().takeIf { it.isNotEmpty() }
        val horario = findViewById<View>(R.id.act_horario)
        val d = if (modoAhora) horaActual() else desde.leer()
        val h = if (modoAhora) null else hasta.leer()
        if (d == null || (!modoAhora && h == null && !hasta.vacio())) return mostrarError(R.string.crono_error_hora, horario)
        if (h != null && HoraCronograma.aMinutos(h) <= HoraCronograma.aMinutos(d)) return mostrarError(R.string.crono_error_rango_noche, horario)
        if (tipo == TipoActividad.VISITA && textoLugar == null) return mostrarError(R.string.crono_error_lugar, findViewById(R.id.act_lugar_card))
        if (tipo == TipoActividad.NOVEDAD && textoNota == null) return mostrarError(R.string.crono_error_nota)
        if (ajustes.any { it.cruce == Cruce.CUBIERTA }) return mostrarError(R.string.crono_error_cruce, horario)
        val cierre = cierreEnCurso
        if (cierre != null && HoraCronograma.aMinutos(d) <= HoraCronograma.aMinutos(cierre.hora)) {
            return mostrarError(R.string.crono_error_en_curso, horario)
        }
        val esta = existente?.copy(hora = d, horaFin = h, tipo = tipo, lugar = textoLugar, nota = textoNota)
            ?: Actividades.nueva(this, fecha, hoy(), tipo, d, h, textoLugar, textoNota, paradaLat, paradaLon)
        // Las vecinas se acomodan a lo que se acaba de escribir.
        val vecinas = ajustes.flatMap { aj ->
            val a = aj.actividad
            val t = aj.tramos
            when (aj.cruce) {
                Cruce.RECORTAR_FIN -> listOf(a.copy(horaFin = HoraCronograma.deMinutos(t[0].fin)))
                Cruce.CORRER_INICIO -> listOf(a.copy(hora = HoraCronograma.deMinutos(t[0].inicio)))
                // La segunda parte de la que estaba en curso sigue en curso.
                Cruce.DIVIDIR -> listOf(
                    a.copy(horaFin = HoraCronograma.deMinutos(t[0].fin)),
                    a.copy(
                        clientId = UUID.randomUUID().toString(),
                        hora = HoraCronograma.deMinutos(t[1].inicio),
                        horaFin = if (a.horaFin == null) null else HoraCronograma.deMinutos(t[1].fin),
                    ),
                )
                Cruce.CUBIERTA -> emptyList()
            }
        } + listOfNotNull(cierre?.copy(horaFin = d))
        Actividades.guardarVarias(this, vecinas + esta)
        setResult(RESULT_OK)
        finish()
    }

    private fun confirmarEliminar() {
        val actual = existente ?: return
        if (CierreDia.cerrado(fecha)) return mostrarError(R.string.crono_dia_cerrado)
        AlertDialog.Builder(this)
            .setMessage(R.string.crono_confirmar_eliminar)
            .setPositiveButton(R.string.crono_eliminar) { _, _ ->
                Actividades.eliminar(this, actual)
                setResult(RESULT_OK)
                finish()
            }
            .setNegativeButton(R.string.crono_cancelar, null)
            .show()
    }

    private fun confirmarEliminarVecina(vecina: Actividad) {
        AlertDialog.Builder(this)
            .setMessage(getString(R.string.crono_confirmar_eliminar_fmt, conRango(vecina, tramoDe(vecina) ?: return)))
            .setPositiveButton(R.string.crono_eliminar) { _, _ ->
                Actividades.eliminar(this, vecina)
                cambios = true
                refrescar()
            }
            .setNegativeButton(R.string.crono_cancelar, null)
            .show()
    }

    private fun salir() {
        if (!cambios) return finish()
        AlertDialog.Builder(this)
            .setMessage(R.string.crono_descartar)
            .setPositiveButton(R.string.crono_descartar_si) { _, _ -> finish() }
            .setNegativeButton(R.string.crono_seguir_editando, null)
            .show()
    }

    /**
     * Campo de hora en 24 h. Lo escrito se interpreta con
     * [HoraCronograma.interpretarNatural]; al salir del campo queda como
     * "HH:mm".
     */
    private inner class CampoHora(
        idTexto: Int,
        private val despuesDe: () -> Int?,
        private val alCambiar: () -> Unit,
    ) {
        private val texto = findViewById<EditText>(idTexto)
        private var programando = false

        /** La persona escribió en este campo. */
        var tocado = false

        init {
            // Tocar el campo abre la rueda en lugar del teclado.
            texto.showSoftInputOnFocus = false
            // Sin selección de texto: arrastrar el dedo no sombrea la hora.
            texto.setTextIsSelectable(false)
            texto.isLongClickable = false
            texto.isCursorVisible = false
            // Un toque (sin moverse) abre la rueda al primer intento; el arrastre no lo abre.
            val umbral = android.view.ViewConfiguration.get(texto.context).scaledTouchSlop
            var bajoX = 0f
            var bajoY = 0f
            texto.setOnTouchListener { _, e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        bajoX = e.x
                        bajoY = e.y
                    }
                    MotionEvent.ACTION_UP -> {
                        if (abs(e.x - bajoX) < umbral && abs(e.y - bajoY) < umbral) abrirRueda(this@CampoHora)
                    }
                }
                true
            }
            texto.setOnFocusChangeListener { _, conFoco -> if (!conFoco) normalizar() }
            texto.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) {
                    if (programando) return
                    tocado = true
                    alCambiar()
                }
            })
        }

        /** Escribe la hora como si la persona la hubiera tecleado (marca el campo como tocado). */
        fun elegir(hora24: String) {
            if (texto.text.toString() != hora24) texto.setText(hora24)
        }

        fun vacio(): Boolean = texto.text.isBlank()

        fun leer(): String? = HoraCronograma.interpretarNatural(texto.text.toString(), null, despuesDe())?.hora24

        /** Pone la hora (o deja el campo vacío con null). */
        fun poner(hora24: String?) {
            programando = true
            texto.setText(hora24.orEmpty())
            programando = false
        }

        /** "930" -> "09:30" al salir del campo, sin cambiar la hora. */
        fun normalizar() {
            val valor = leer() ?: return
            if (texto.text.toString() != valor) poner(valor)
        }
    }

    // Rueda de hora: Hasta no baja de Desde; se queda en ese valor.
    private fun abrirRueda(campo: CampoHora) {
        val rueda = findViewById<RuedaHora>(R.id.act_rueda)
        val esHasta = campo === hasta
        val d = desde.leer()?.let { HoraCronograma.aMinutos(it) }
        val actual = campo.leer()?.let { HoraCronograma.aMinutos(it) } ?: d ?: HoraCronograma.aMinutos(INICIO_DIA)
        rueda.alCambiar = null
        rueda.poner(actual, if (esHasta) d ?: 0 else 0)
        rueda.alCambiar = { m -> campo.elegir(HoraCronograma.deMinutos(m)) }
        // Entra desde arriba con desaceleración: se nota que se despliega.
        if (rueda.visibility != View.VISIBLE) {
            rueda.alpha = 0f
            rueda.translationY = -dp(10).toFloat()
            rueda.visibility = View.VISIBLE
            rueda.animate().alpha(1f).translationY(0f).setDuration(260)
                .setInterpolator(android.view.animation.DecelerateInterpolator()).start()
        }
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(rueda.windowToken, 0)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_FECHA = "fecha"
        const val EXTRA_ID = "clientId"
        const val EXTRA_DESDE = "desde"
        const val EXTRA_HASTA = "hasta"
        const val EXTRA_LAT = "lat"
        const val EXTRA_LON = "lon"

        private const val TODO_EL_DIA = -1
        private val AUSENCIAS = setOf(TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO)

        /** Orden de las fichas: lo de todos los días primero. */
        /** Las visitas express suelen ser cortas: se proponen de 30 min; el resto, de 1 h. */
        private fun duracionInicial(tipo: TipoActividad): Int = if (tipo == TipoActividad.VISITA) 30 else 60

        private val ORDEN_TIPOS = listOf(
            TipoActividad.VISITA, TipoActividad.ALMUERZO, TipoActividad.NOVEDAD,
            TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.VACACIONES,
        )

        /** Cliente "cerca" de la parada: se ofrece primero. */

        private const val KEY_TIPO = "tipo"
        private const val KEY_DESDE = "desde"
        private const val KEY_HASTA = "hasta"
        private const val KEY_DESDE_TOCADO = "desdeTocado"
        private const val KEY_HASTA_TOCADO = "hastaTocado"
        private const val KEY_CAMBIOS = "cambios"
        private const val KEY_MODO_AHORA = "modoAhora"

        /** Día de trabajo para "Todo el día" (vacaciones, permisos). */
        const val INICIO_DIA = "08:00"
        const val FIN_DIA = "17:00"

        /** [lat]/[lon]: la parada del GPS desde la que se registra (ordena los clientes cercanos). */
        fun abrir(
            context: Context,
            fecha: String,
            actividad: Actividad? = null,
            desde: String? = null,
            hasta: String? = null,
            lat: Double? = null,
            lon: Double? = null,
        ) {
            context.startActivity(
                Intent(context, ActividadActivity::class.java)
                    .putExtra(EXTRA_FECHA, fecha)
                    .putExtra(EXTRA_ID, actividad?.clientId)
                    .putExtra(EXTRA_DESDE, desde)
                    .putExtra(EXTRA_HASTA, hasta)
                    .putExtra(EXTRA_LAT, lat ?: Double.NaN)
                    .putExtra(EXTRA_LON, lon ?: Double.NaN),
            )
        }
    }
}

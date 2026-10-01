package com.dmujeres.app.cronograma

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.dmujeres.app.R
import com.dmujeres.app.Responsivo
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
 * - Nueva de hoy: Desde = hora actual y Hasta = una hora después. Desde un
 *   hueco del día llegan sus horas; en otro día, después de la última.
 * - La hora se escribe ("9", "930", "14:30"); el AM/PM se deduce como en una
 *   jornada ("de 11 a 2" es de 11 a. m. a 2 p. m.) y se puede tocar a mano.
 * - Hasta acompaña a Desde (misma duración) mientras no se toque.
 * - Si se cruza con otra actividad, se ve antes de guardar cómo se acomoda la
 *   vecina (AgendaDia) y se ofrece mover esta en su lugar.
 */
class ActividadActivity : AppCompatActivity() {

    private val zona = TimeZone.getTimeZone("America/Guayaquil")
    private val iso = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }
    private val es = Locale("es", "EC")

    private lateinit var fecha: String
    private var existente: Actividad? = null
    private var tipo = TipoActividad.VISITA
    private lateinit var desde: CampoHora
    private lateinit var hasta: CampoHora
    private var duracion = 60
    private var cambios = false
    private var ajustes: List<AgendaDia.Ajuste<Actividad>> = emptyList()
    private val chips = mutableMapOf<TipoActividad, TextView>()

    private lateinit var lugar: AutoCompleteTextView
    private lateinit var nota: EditText
    private lateinit var error: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_actividad)
        Responsivo.raiz(this)?.let { Responsivo.centrarHijos(it, Responsivo.ANCHO_PANEL_DP) }

        fecha = intent.getStringExtra(EXTRA_FECHA) ?: hoy()
        existente = intent.getStringExtra(EXTRA_ID)?.let { id ->
            Actividades.todas(this).firstOrNull { it.clientId == id && !it.eliminada }
        }
        val actual = existente
        lugar = findViewById(R.id.act_lugar)
        nota = findViewById(R.id.act_nota)
        error = findViewById(R.id.act_error)

        findViewById<TextView>(R.id.act_titulo).setText(if (actual == null) R.string.crono_nueva else R.string.crono_editar)
        findViewById<TextView>(R.id.act_fecha).text = fechaLegible()
        findViewById<View>(R.id.act_volver).setOnClickListener { salir() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = salir()
        })

        desde = CampoHora(R.id.act_desde, R.id.act_desde_am, R.id.act_desde_pm, { null }) { alCambiarDesde() }
        hasta = CampoHora(R.id.act_hasta, R.id.act_hasta_am, R.id.act_hasta_pm, {
            desde.leer()?.let { HoraCronograma.aMinutos(it) }
        }) { alCambiarHasta() }

        tipo = savedInstanceState?.getString(KEY_TIPO)?.let { TipoActividad.de(it) } ?: actual?.tipo ?: TipoActividad.VISITA
        val (inicio, fin) = horasIniciales(actual, savedInstanceState)
        desde.poner(inicio)
        hasta.poner(fin)
        duracion = (HoraCronograma.aMinutos(fin) - HoraCronograma.aMinutos(inicio)).takeIf { it > 0 } ?: 60
        if (savedInstanceState != null) {
            desde.tocado = savedInstanceState.getBoolean(KEY_DESDE_TOCADO)
            hasta.tocado = savedInstanceState.getBoolean(KEY_HASTA_TOCADO)
            cambios = savedInstanceState.getBoolean(KEY_CAMBIOS)
        } else {
            lugar.setText(actual?.lugar.orEmpty())
            nota.setText(actual?.nota.orEmpty())
        }

        armarTipos()
        armarLugares()
        findViewById<View>(R.id.act_todo_dia).setOnClickListener {
            desde.poner(INICIO_DIA)
            hasta.poner(FIN_DIA)
            desde.tocado = true
            hasta.tocado = true
            cambios = true
            refrescar()
        }
        val alEscribir = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                cambios = true
                error.visibility = View.GONE
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
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(KEY_TIPO, tipo.codigo)
        desde.leer()?.let { outState.putString(KEY_DESDE, it) }
        hasta.leer()?.let { outState.putString(KEY_HASTA, it) }
        outState.putBoolean(KEY_DESDE_TOCADO, desde.tocado)
        outState.putBoolean(KEY_HASTA_TOCADO, hasta.tocado)
        outState.putBoolean(KEY_CAMBIOS, cambios)
    }

    // ── Datos de partida ───────────────────────────────────────────────────

    private fun hoy(): String = iso.format(Calendar.getInstance(zona).time)

    private fun horaActual(): String {
        val c = Calendar.getInstance(zona)
        return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    }

    private fun delDiaSinEsta(): List<Actividad> =
        Actividades.delDia(this, fecha).filter { it.clientId != existente?.clientId }

    private fun horasIniciales(actual: Actividad?, estado: Bundle?): Pair<String, String> {
        val guardadoDesde = estado?.getString(KEY_DESDE)
        val guardadoHasta = estado?.getString(KEY_HASTA)
        if (guardadoDesde != null && guardadoHasta != null) return guardadoDesde to guardadoHasta
        if (actual != null) {
            // Sin hora de fin: hasta la siguiente actividad o una hora.
            val siguiente = delDiaSinEsta().firstOrNull { it.hora > actual.hora }?.hora
            return actual.hora to (actual.horaFin ?: siguiente ?: HoraCronograma.sumar(actual.hora, 60))
        }
        val pedidoDesde = intent.getStringExtra(EXTRA_DESDE)
        val pedidoHasta = intent.getStringExtra(EXTRA_HASTA)
        if (pedidoDesde != null && pedidoHasta != null) return pedidoDesde to pedidoHasta
        val inicio = when {
            fecha == hoy() -> horaActual()
            // Otro día: después de lo último cargado, o al empezar la jornada.
            else -> delDiaSinEsta().mapNotNull { it.horaFin ?: it.hora }.maxOrNull() ?: INICIO_DIA
        }
        return inicio to HoraCronograma.sumar(inicio, 60)
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

    private fun armarTipos() {
        val fila1 = findViewById<LinearLayout>(R.id.act_tipos_1)
        val fila2 = findViewById<LinearLayout>(R.id.act_tipos_2)
        TipoActividad.entries.forEachIndexed { i, t ->
            val v = TextView(this).apply {
                text = t.etiqueta
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setTypeface(typeface, Typeface.BOLD)
                setBackgroundResource(R.drawable.ds_chip_tipo)
                layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply {
                    if (i % 3 != 2) marginEnd = dp(6)
                }
                setOnClickListener {
                    if (tipo == t) return@setOnClickListener
                    tipo = t
                    cambios = true
                    // Vacaciones es el día entero (si las horas no se tocaron).
                    if (t == TipoActividad.VACACIONES && !desde.tocado && !hasta.tocado) {
                        desde.poner(INICIO_DIA)
                        hasta.poner(FIN_DIA)
                        duracion = HoraCronograma.aMinutos(FIN_DIA) - HoraCronograma.aMinutos(INICIO_DIA)
                    }
                    aplicarTipo()
                    refrescar()
                }
            }
            chips[t] = v
            (if (i < 3) fila1 else fila2).addView(v)
        }
    }

    private fun aplicarTipo() {
        chips.forEach { (t, v) ->
            v.isSelected = t == tipo
            v.setTextColor(getColor(if (t == tipo) R.color.white else R.color.text_primary))
        }
        val conLugar = tipo == TipoActividad.VISITA || tipo == TipoActividad.NOVEDAD
        findViewById<View>(R.id.act_lugar_card).visibility = if (conLugar) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.act_nota_label).setText(
            if (tipo == TipoActividad.NOVEDAD) R.string.crono_nota_obligatoria else R.string.crono_nota,
        )
        val ausencia = tipo == TipoActividad.VACACIONES || tipo == TipoActividad.PERMISO_MEDICO || tipo == TipoActividad.PERMISO
        findViewById<View>(R.id.act_todo_dia).visibility = if (ausencia) View.VISIBLE else View.GONE
    }

    /** Lugares de siempre a un toque (y en la lista al escribir). */
    private fun armarLugares() {
        val frecuentes = Actividades.lugaresFrecuentes(this)
        lugar.setAdapter(ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, frecuentes))
        val fila = findViewById<LinearLayout>(R.id.act_lugares)
        frecuentes.take(8).forEach { nombre ->
            fila.addView(TextView(this).apply {
                text = nombre
                gravity = Gravity.CENTER
                maxLines = 1
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                setTextColor(getColor(R.color.text_primary))
                setBackgroundResource(R.drawable.ds_chip_tipo)
                setPadding(dp(12), 0, dp(12), 0)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply {
                    marginEnd = dp(6)
                }
                setOnClickListener {
                    lugar.setText(nombre)
                    lugar.setSelection(nombre.length)
                    lugar.dismissDropDown()
                }
            })
        }
        findViewById<View>(R.id.act_lugares_scroll).visibility = if (frecuentes.isEmpty()) View.GONE else View.VISIBLE
    }

    // ── Horario ────────────────────────────────────────────────────────────

    private fun alCambiarDesde() {
        cambios = true
        val d = desde.leer()
        // Hasta acompaña a Desde con la misma duración mientras no se toque.
        if (d != null && !hasta.tocado) hasta.poner(HoraCronograma.sumar(d, duracion))
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

    private fun tramoDe(a: Actividad): Tramo? = a.horaFin?.let {
        Tramo(HoraCronograma.aMinutos(a.hora), HoraCronograma.aMinutos(it)).takeIf { t -> t.fin > t.inicio }
    }

    private fun refrescar() {
        error.visibility = View.GONE
        desde.reflejar()
        hasta.reflejar()
        val resumen = findViewById<TextView>(R.id.act_resumen)
        val d = desde.leer()
        val h = hasta.leer()
        val tramo = tramoElegido()
        when {
            d == null || h == null -> {
                resumen.setText(R.string.crono_resumen_falta)
                resumen.setTextColor(getColor(R.color.text_secondary))
            }
            tramo == null -> {
                resumen.setText(R.string.crono_error_rango_noche)
                resumen.setTextColor(getColor(R.color.primary))
            }
            else -> {
                resumen.text = getString(R.string.crono_resumen_fmt, HoraCronograma.duracion(tramo.minutos), HoraCronograma.rangoCorto(d, h))
                resumen.setTextColor(getColor(R.color.text_secondary))
            }
        }
        ajustes = if (tramo != null) AgendaDia.ajustes(delDiaSinEsta(), tramo, ::tramoDe) else emptyList()
        pintarCruce(tramo)
    }

    private fun nombre(a: Actividad): String =
        listOfNotNull(a.tipo.etiqueta, a.lugar?.takeIf { it.isNotBlank() }).joinToString(" · ")

    private fun conRango(a: Actividad, t: Tramo): String = "${nombre(a)} (${rangoDe(t)})"

    private fun rangoDe(t: Tramo): String =
        HoraCronograma.rangoCorto(HoraCronograma.deMinutos(t.inicio), HoraCronograma.deMinutos(t.fin))

    private fun pintarCruce(tramo: Tramo?) {
        val caja = findViewById<View>(R.id.act_cruce)
        if (ajustes.isEmpty() || tramo == null) {
            caja.visibility = View.GONE
            return
        }
        caja.visibility = View.VISIBLE
        val titulo = findViewById<TextView>(R.id.act_cruce_titulo)
        val texto = findViewById<TextView>(R.id.act_cruce_texto)
        val accion = findViewById<TextView>(R.id.act_cruce_accion)
        val tapadas = ajustes.filter { it.cruce == Cruce.CUBIERTA }
        val lineas = ajustes.map { aj ->
            val n = conRango(aj.actividad, aj.antes)
            when (aj.cruce) {
                Cruce.RECORTAR_FIN -> getString(R.string.crono_cruce_recorta_fmt, n, HoraCronograma.legible(HoraCronograma.deMinutos(aj.tramos[0].fin)))
                Cruce.CORRER_INICIO -> getString(R.string.crono_cruce_corre_fmt, n, HoraCronograma.legible(HoraCronograma.deMinutos(aj.tramos[0].inicio)))
                Cruce.DIVIDIR -> getString(R.string.crono_cruce_divide_fmt, n, rangoDe(aj.tramos[0]), rangoDe(aj.tramos[1]))
                Cruce.CUBIERTA -> getString(R.string.crono_cruce_cubre_fmt, nombre(aj.actividad), rangoDe(aj.antes))
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
        desde.normalizar()
        hasta.normalizar()
        refrescar()
        val conLugar = tipo == TipoActividad.VISITA || tipo == TipoActividad.NOVEDAD
        val textoLugar = lugar.text.toString().trim().takeIf { it.isNotEmpty() && conLugar }
        val textoNota = nota.text.toString().trim().takeIf { it.isNotEmpty() }
        val horario = findViewById<View>(R.id.act_horario)
        val d = desde.leer()
        val h = hasta.leer()
        if (d == null || h == null) return mostrarError(R.string.crono_error_hora, horario)
        if (HoraCronograma.aMinutos(h) <= HoraCronograma.aMinutos(d)) return mostrarError(R.string.crono_error_rango_noche, horario)
        if (tipo == TipoActividad.VISITA && textoLugar == null) return mostrarError(R.string.crono_error_lugar, findViewById(R.id.act_lugar_card))
        if (tipo == TipoActividad.NOVEDAD && textoNota == null) return mostrarError(R.string.crono_error_nota)
        if (ajustes.any { it.cruce == Cruce.CUBIERTA }) return mostrarError(R.string.crono_error_cruce, horario)
        val esta = existente?.copy(hora = d, horaFin = h, tipo = tipo, lugar = textoLugar, nota = textoNota)
            ?: Actividades.nueva(this, fecha, hoy(), tipo, d, h, textoLugar, textoNota)
        // Las vecinas se acomodan a lo que se acaba de escribir.
        val vecinas = ajustes.flatMap { aj ->
            val a = aj.actividad
            val t = aj.tramos
            when (aj.cruce) {
                Cruce.RECORTAR_FIN -> listOf(a.copy(horaFin = HoraCronograma.deMinutos(t[0].fin)))
                Cruce.CORRER_INICIO -> listOf(a.copy(hora = HoraCronograma.deMinutos(t[0].inicio)))
                Cruce.DIVIDIR -> listOf(
                    a.copy(horaFin = HoraCronograma.deMinutos(t[0].fin)),
                    a.copy(clientId = UUID.randomUUID().toString(), hora = HoraCronograma.deMinutos(t[1].inicio), horaFin = HoraCronograma.deMinutos(t[1].fin)),
                )
                Cruce.CUBIERTA -> emptyList()
            }
        }
        Actividades.guardarVarias(this, vecinas + esta)
        if (vecinas.isNotEmpty()) {
            val nombres = ajustes.map { nombre(it.actividad) }.distinct().joinToString(", ")
            Toast.makeText(this, getString(R.string.crono_ajustada_fmt, nombres), Toast.LENGTH_LONG).show()
        }
        setResult(RESULT_OK)
        finish()
    }

    private fun confirmarEliminar() {
        val actual = existente ?: return
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
     * Campo de hora con AM/PM. Lo puesto por la app (hora actual, la de la
     * actividad) se lee tal cual; lo escrito a mano se interpreta con
     * [HoraCronograma.interpretarNatural] y el AM/PM tocado manda.
     */
    private inner class CampoHora(
        idTexto: Int,
        idAm: Int,
        idPm: Int,
        private val despuesDe: () -> Int?,
        private val alCambiar: () -> Unit,
    ) {
        private val texto = findViewById<EditText>(idTexto)
        private val am = findViewById<TextView>(idAm)
        private val pm = findViewById<TextView>(idPm)
        private var pmManual: Boolean? = null
        private var puesto: Pair<String, String>? = null
        private var programando = false

        /** La persona escribió o tocó AM/PM en este campo. */
        var tocado = false

        init {
            am.setOnClickListener { tocarAmPm(false) }
            pm.setOnClickListener { tocarAmPm(true) }
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

        private fun tocarAmPm(valor: Boolean) {
            pmManual = valor
            tocado = true
            alCambiar()
        }

        fun leer(): String? {
            val actual = texto.text.toString()
            val p = puesto
            if (p != null && pmManual == null && actual == p.first) return p.second
            return HoraCronograma.interpretarNatural(actual, pmManual, despuesDe())?.hora24
        }

        /** Marca AM o PM según lo que se va a guardar. */
        fun reflejar() {
            val esPm = leer()?.let { HoraCronograma.esPm(it) } ?: pmManual ?: return
            am.isSelected = !esPm
            pm.isSelected = esPm
            am.setTextColor(getColor(if (!esPm) R.color.white else R.color.text_primary))
            pm.setTextColor(getColor(if (esPm) R.color.white else R.color.text_primary))
        }

        fun poner(hora24: String) {
            val visible = HoraCronograma.a12(hora24)
            programando = true
            texto.setText(visible)
            programando = false
            puesto = visible to hora24
            pmManual = null
            reflejar()
        }

        /** "930" -> "09:30" al salir del campo, sin cambiar la hora. */
        fun normalizar() {
            val valor = leer() ?: return
            if (texto.text.toString() != HoraCronograma.a12(valor) || pmManual != null) poner(valor)
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_FECHA = "fecha"
        const val EXTRA_ID = "clientId"
        const val EXTRA_DESDE = "desde"
        const val EXTRA_HASTA = "hasta"

        private const val KEY_TIPO = "tipo"
        private const val KEY_DESDE = "desde"
        private const val KEY_HASTA = "hasta"
        private const val KEY_DESDE_TOCADO = "desdeTocado"
        private const val KEY_HASTA_TOCADO = "hastaTocado"
        private const val KEY_CAMBIOS = "cambios"

        /** Día de trabajo para "Todo el día" (vacaciones, permisos). */
        const val INICIO_DIA = "08:00"
        const val FIN_DIA = "17:00"

        fun abrir(context: Context, fecha: String, actividad: Actividad? = null, desde: String? = null, hasta: String? = null) {
            context.startActivity(
                Intent(context, ActividadActivity::class.java)
                    .putExtra(EXTRA_FECHA, fecha)
                    .putExtra(EXTRA_ID, actividad?.clientId)
                    .putExtra(EXTRA_DESDE, desde)
                    .putExtra(EXTRA_HASTA, hasta),
            )
        }
    }
}

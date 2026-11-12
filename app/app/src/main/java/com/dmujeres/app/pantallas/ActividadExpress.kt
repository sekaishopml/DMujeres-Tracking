package com.dmujeres.app.pantallas

import android.app.Activity
import android.content.Intent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.widget.doAfterTextChanged
import com.dmujeres.app.R
import com.dmujeres.app.cronograma.Actividad
import com.dmujeres.app.cronograma.Actividades
import com.dmujeres.app.cronograma.BuscadorLugares
import com.dmujeres.app.cronograma.CierreDia
import com.dmujeres.app.cronograma.CronogramaActivity
import com.dmujeres.app.cronograma.HoraCronograma
import com.dmujeres.app.cronograma.TipoActividad

/**
 * Tarjeta de actividad del inicio. Visitan muchos sitios al día y el
 * formulario completo quitaba tiempo: aquí se elige qué hace (visita o
 * permiso), se escribe o se toca uno de los lugares ya usados y se inicia a
 * la hora actual. "Más…" lleva al formulario con los demás tipos. Con una
 * iniciada muestra "Actividad en curso" con el lugar y el tiempo. El lugar lo
 * pone la persona; la app no lo deduce del GPS. Otros tipos y otras horas van
 * al formulario del cronograma.
 */
class ActividadExpress(private val pantalla: Activity) {

    private val tarjeta = pantalla.findViewById<LinearLayout>(R.id.actividad_card)
    private val cuerpo = pantalla.findViewById<android.view.ViewGroup>(R.id.cuerpo)
    private val vacia = pantalla.findViewById<View>(R.id.act_home_vacia)
    private val form = pantalla.findViewById<View>(R.id.act_home_form)
    private val curso = pantalla.findViewById<View>(R.id.act_home_curso)
    private val lugar = pantalla.findViewById<android.widget.EditText>(R.id.act_home_lugar)
    private val aviso = pantalla.findViewById<TextView>(R.id.act_home_error)
    private val visita = pantalla.findViewById<TextView>(R.id.act_home_tipo_visita)
    private val permiso = pantalla.findViewById<TextView>(R.id.act_home_tipo_permiso)
    private val sugerencias = pantalla.findViewById<LinearLayout>(R.id.act_home_sugerencias)

    /** Lo escrito antes en este tipo, del más usado al menos; se lee al abrir. */
    private var usados: List<String> = emptyList()

    private var tipo = TipoActividad.VISITA
    private var abierto = false

    /** La persona está escribiendo aquí (no se le abre la actualización encima). */
    fun ocupada(): Boolean = abierto || editandoNota
    private var abierta: Actividad? = null

    /** Nota exprés de la actividad en curso, escrita en la misma tarjeta. */
    private var editandoNota = false
    private val notaCampo = pantalla.findViewById<android.widget.EditText>(R.id.act_home_nota_campo)

    /** Con el formulario o la nota abiertos, el botón Atrás del teléfono los cierra (no sale de la app). */
    private val volver = object : androidx.activity.OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = if (editandoNota) cerrarNota() else cerrar()
    }

    init {
        (pantalla as? androidx.activity.ComponentActivity)?.let { it.onBackPressedDispatcher.addCallback(it, volver) }
        pantalla.findViewById<View>(R.id.act_home_iniciar).setOnClickListener { abrir() }
        pantalla.findViewById<View>(R.id.act_home_siguiente).setOnClickListener { abrir() }
        pantalla.findViewById<View>(R.id.act_home_cancelar).setOnClickListener { cerrar() }
        pantalla.findViewById<View>(R.id.act_home_guardar).setOnClickListener { iniciar() }
        pantalla.findViewById<View>(R.id.act_home_finalizar).setOnClickListener { finalizar() }
        pantalla.findViewById<View>(R.id.act_home_nota).setOnClickListener { abrirNota() }
        pantalla.findViewById<View>(R.id.act_home_nota_guardar).setOnClickListener { guardarNota() }
        pantalla.findViewById<View>(R.id.act_home_nota_volver).setOnClickListener { cerrarNota() }
        notaCampo.setOnEditorActionListener { _, _, _ -> guardarNota(); true }
        pantalla.findViewById<View>(R.id.cronograma_card).setOnClickListener {
            pantalla.startActivity(Intent(pantalla, CronogramaActivity::class.java))
        }
        visita.setOnClickListener { elegir(TipoActividad.VISITA) }
        permiso.setOnClickListener { elegir(TipoActividad.PERMISO) }
        // Los demás tipos (almuerzo, vacaciones, novedad...) van al formulario completo.
        val mas = pantalla.findViewById<View>(R.id.act_home_tipo_mas)
        mas.setOnClickListener {
            cerrar()
            com.dmujeres.app.cronograma.ActividadActivity.abrir(pantalla, hoy())
        }
        lugar.setOnEditorActionListener { _, _, _ -> iniciar(); true }
        lugar.doAfterTextChanged {
            if (!it.isNullOrEmpty()) quitarAviso()
            pintarSugerencias()
        }
        aviso.setOnClickListener {
            quitarAviso()
            lugar.requestFocus()
            (pantalla.getSystemService(Activity.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showSoftInput(lugar, InputMethodManager.SHOW_IMPLICIT)
        }
        Animaciones.respuestaAlToque(
            pantalla.findViewById(R.id.act_home_iniciar), pantalla.findViewById(R.id.act_home_guardar),
            pantalla.findViewById(R.id.act_home_finalizar), visita, permiso, mas,
            pantalla.findViewById(R.id.act_home_cancelar),
            pantalla.findViewById(R.id.act_home_nota), pantalla.findViewById(R.id.act_home_siguiente),
            pantalla.findViewById(R.id.act_home_nota_guardar), pantalla.findViewById(R.id.act_home_nota_volver),
            pantalla.findViewById(R.id.cronograma_card),
        )
    }

    /** Pinta el estado; se llama en cada refresco del inicio (no toca lo que se escribe). */
    fun refrescar() {
        val ahora = horaActual()
        val delDia = Actividades.delDia(pantalla, hoy())
        abierta = HoraCronograma.enCurso(delDia, ahora, { it.hora }, { it.horaFin })
            ?.takeIf { it.horaFin == null && it.hora <= ahora }
        val actual = abierta
        val enCurso = actual != null && !abierto
        // Si la actividad terminó (por ejemplo, desde el cronograma), la nota se cierra.
        if (actual == null) editandoNota = false
        volver.isEnabled = abierto || editandoNota
        pantalla.findViewById<View>(R.id.act_home_nota_editor).visibility = if (editandoNota) View.VISIBLE else View.GONE
        pantalla.findViewById<View>(R.id.act_home_curso_acciones).visibility = if (editandoNota) View.GONE else View.VISIBLE
        pantalla.findViewById<View>(R.id.act_home_finalizar).visibility = if (editandoNota) View.GONE else View.VISIBLE
        vacia.visibility = if (!abierto && actual == null) View.VISIBLE else View.GONE
        // Anotando, la tarjeta ocupa la pantalla (sin scroll ni con el
        // teclado abierto): lo demás vuelve al iniciar o cancelar.
        for (id in OCULTAS_AL_ANOTAR) {
            pantalla.findViewById<View>(id)?.visibility = if (abierto || editandoNota) View.GONE else View.VISIBLE
        }
        form.visibility = if (abierto) View.VISIBLE else View.GONE
        curso.visibility = if (enCurso) View.VISIBLE else View.GONE
        Animaciones.fondo(tarjeta, if (enCurso) R.drawable.ds_tarjeta_marino else R.drawable.ds_hero)
        if (actual != null && enCurso) {
            pantalla.findViewById<TextView>(R.id.act_home_curso_lugar).text =
                actual.lugar ?: actual.nota ?: actual.tipo.etiqueta
            // Con nota guardada, se ve al final de la línea (así se sabe que quedó).
            val notaVisible = actual.nota?.takeIf { actual.lugar != null }?.let { " · “$it”" }.orEmpty()
            pantalla.findViewById<TextView>(R.id.act_home_curso_detalle).text = pantalla.getString(
                R.string.act_home_desde_fmt, actual.tipo.etiqueta, HoraCronograma.legible(actual.hora),
            ) + notaVisible
            pantalla.findViewById<TextView>(R.id.act_home_curso_tiempo).text =
                HoraCronograma.duracion(HoraCronograma.aMinutos(ahora) - HoraCronograma.aMinutos(actual.hora))
        }
        if (abierto) {
            pantalla.findViewById<TextView>(R.id.act_home_ayuda).text = pantalla.getString(
                if (actual != null) R.string.act_home_ayuda_cierra_fmt else R.string.act_home_ayuda_fmt,
                HoraCronograma.legible(ahora),
            )
        }
        // "Hoy" y el acceso al cronograma, legibles también sobre la tarjeta marina.
        val hoyTexto = pantalla.findViewById<TextView>(R.id.act_home_hoy)
        hoyTexto.text = when (delDia.size) {
            0 -> pantalla.getString(R.string.act_home_hoy_ninguna)
            1 -> pantalla.getString(R.string.act_home_hoy_una)
            else -> pantalla.getString(R.string.act_home_hoy_fmt, delDia.size)
        }
        // El botón tiene fondo propio: sus colores no cambian con la tarjeta marina.
        hoyTexto.setTextColor(pantalla.getColor(R.color.text_primary))
    }

    private fun abrir() {
        if (abierto) return
        abierto = true
        aviso.visibility = View.GONE
        lugar.setText("")
        elegir(TipoActividad.VISITA)
        Animaciones.fluido(cuerpo)
        refrescar()
        // El teclado se abre solo: en la visita express se escribe el lugar enseguida.
        lugar.requestFocus()
        lugar.post {
            (pantalla.getSystemService(Activity.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showSoftInput(lugar, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun cerrar() {
        abierto = false
        ocultarTeclado()
        Animaciones.fluido(cuerpo)
        refrescar()
    }

    private fun elegir(t: TipoActividad) {
        tipo = t
        mapOf(visita to TipoActividad.VISITA, permiso to TipoActividad.PERMISO).forEach { (vista, suyo) ->
            vista.isSelected = suyo == t
            vista.setTextColor(pantalla.getColor(if (suyo == t) R.color.white else R.color.text_primary))
        }
        // La visita pide dónde; el permiso, una nota (opcional).
        val esVisita = t == TipoActividad.VISITA
        pantalla.findViewById<TextView>(R.id.act_home_campo_titulo)
            .setText(if (esVisita) R.string.act_home_donde else R.string.act_home_nota)
        lugar.setHint(if (esVisita) R.string.act_home_lugar_hint else R.string.act_home_nota_hint)
        aviso.visibility = View.GONE
        usados = if (esVisita) Actividades.lugaresFrecuentes(pantalla) else Actividades.notasFrecuentes(pantalla, t)
        pintarSugerencias()
    }

    /** Lo escrito antes, ordenado por lo que se va escribiendo; un toque lo pone en el campo. */
    private fun pintarSugerencias() {
        sugerencias.removeAllViews()
        val d = pantalla.resources.displayMetrics.density
        BuscadorLugares.ordenar(usados, lugar.text.toString()).forEach { texto ->
            sugerencias.addView(TextView(pantalla).apply {
                text = texto
                gravity = android.view.Gravity.CENTER
                maxLines = 1
                textSize = 14f
                setTextColor(pantalla.getColor(R.color.text_primary))
                setBackgroundResource(R.drawable.ds_chip_tipo)
                setPadding((14 * d).toInt(), 0, (14 * d).toInt(), 0)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, (40 * d).toInt())
                    .apply { marginEnd = (6 * d).toInt() }
                setOnClickListener {
                    lugar.setText(texto)
                    lugar.setSelection(texto.length)
                }
            })
        }
        pantalla.findViewById<View>(R.id.act_home_sugerencias_scroll).visibility =
            if (sugerencias.childCount > 0) View.VISIBLE else View.GONE
    }

    private fun iniciar() {
        val fecha = hoy()
        if (CierreDia.cerrado(fecha)) return mostrarError(R.string.crono_dia_cerrado)
        val escrito = lugar.text.toString().trim().takeIf { it.isNotEmpty() }
        if (tipo == TipoActividad.VISITA && escrito == null) return mostrarError(R.string.act_home_falta_lugar)
        val texto = escrito.takeIf { tipo == TipoActividad.VISITA }
        val nota = escrito.takeIf { tipo != TipoActividad.VISITA }
        val d = horaActual()
        val delDia = Actividades.delDia(pantalla, fecha)
        // Sin tiempo mínimo entre actividades; solo una pausa corta contra los toques seguidos.
        val ultima = delDia.maxOfOrNull { it.registradoEn } ?: 0L
        if (System.currentTimeMillis() - ultima in 0 until ESPERA_MS) return mostrarError(R.string.act_home_espere)
        // La que estaba en curso se finaliza a la hora en que empieza la nueva
        // (si es el mismo minuto, queda de 0 minutos).
        val cierre = delDia
            .let { HoraCronograma.enCurso(it, d, { a -> a.hora }, { a -> a.horaFin }) }
            ?.takeIf { it.horaFin == null && it.hora <= d }
        val nueva = Actividades.nueva(pantalla, fecha, fecha, tipo, d, null, texto, nota)
        Actividades.guardarVarias(pantalla, listOfNotNull(cierre?.copy(horaFin = d)) + nueva)
        abierto = false
        ocultarTeclado()
        Animaciones.fluido(cuerpo)
        refrescar()
    }

    private fun finalizar() {
        val actual = abierta ?: return
        val fin = maxOf(horaActual(), HoraCronograma.sumar(actual.hora, 1))
        Actividades.guardar(pantalla, actual.copy(horaFin = fin))
        Animaciones.fluido(cuerpo)
        refrescar()
    }

    /**
     * El aviso aparece dentro del campo del lugar (no ocupa una fila más) y se
     * va con un fundido; tocarlo o escribir lo quita antes. Con almuerzo no
     * hay campo: el aviso va un momento en la línea bajo el título.
     */
    private fun mostrarError(texto: Int) {
        if (pantalla.findViewById<View>(R.id.act_home_donde).visibility != View.VISIBLE) {
            val linea = pantalla.findViewById<TextView>(R.id.act_home_ayuda)
            linea.setText(texto)
            linea.setTextColor(pantalla.getColor(R.color.primary_dark))
            linea.postDelayed({
                linea.setTextColor(pantalla.getColor(R.color.text_secondary))
                refrescar()
            }, AVISO_MS)
            return
        }
        aviso.setText(texto)
        aviso.animate().cancel()
        aviso.alpha = 0f
        aviso.visibility = View.VISIBLE
        aviso.animate().alpha(1f).setStartDelay(0).setDuration(180).withEndAction {
            aviso.animate().alpha(0f).setStartDelay(AVISO_MS).setDuration(450)
                .withEndAction { aviso.visibility = View.GONE }.start()
        }.start()
    }

    private fun quitarAviso() {
        if (aviso.visibility != View.VISIBLE) return
        aviso.animate().cancel()
        aviso.animate().alpha(0f).setStartDelay(0).setDuration(200).withEndAction { aviso.visibility = View.GONE }.start()
    }

    private fun ocultarTeclado(campo: View = lugar) {
        (pantalla.getSystemService(Activity.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(campo.windowToken, 0)
        campo.clearFocus()
    }

    private fun abrirNota() {
        val actual = abierta ?: return
        editandoNota = true
        notaCampo.setText(actual.nota.orEmpty())
        notaCampo.setSelection(notaCampo.text.length)
        Animaciones.fluido(cuerpo)
        refrescar()
        notaCampo.requestFocus()
        notaCampo.post {
            (pantalla.getSystemService(Activity.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showSoftInput(notaCampo, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    /** Guarda la nota en la actividad en curso (vacía la borra) y vuelve a la tarjeta. */
    private fun guardarNota() {
        val actual = abierta
        if (actual != null) {
            val texto = notaCampo.text.toString().trim().takeIf { it.isNotEmpty() }
            if (texto != actual.nota) Actividades.guardar(pantalla, actual.copy(nota = texto))
        }
        cerrarNota()
    }

    private fun cerrarNota() {
        editandoNota = false
        ocultarTeclado(notaCampo)
        Animaciones.fluido(cuerpo)
        refrescar()
    }

    private val zona = java.util.TimeZone.getTimeZone("America/Guayaquil")

    private companion object {
        /** Cuánto queda a la vista un aviso antes de irse. */
        const val AVISO_MS = 2_600L

        /** Pausa entre una actividad nueva y la siguiente. */
        const val ESPERA_MS = 15_000L

        val OCULTAS_AL_ANOTAR = intArrayOf(
            R.id.tarjeta_jornada, R.id.fila_jornada, R.id.resumen_dia, R.id.version_label,
            R.id.espacio_arriba, R.id.cronograma_card,
        )
    }

    private fun hoy(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = zona }.format(java.util.Date())

    private fun horaActual(): String =
        java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).apply { timeZone = zona }.format(java.util.Date())
}

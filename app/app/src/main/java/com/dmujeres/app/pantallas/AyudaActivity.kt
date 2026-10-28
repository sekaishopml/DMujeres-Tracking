package com.dmujeres.app.pantallas

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.dmujeres.app.R
import com.dmujeres.app.cronograma.TipoActividad
import com.dmujeres.app.cronograma.color
import com.dmujeres.app.cronograma.fondo

/**
 * Guía de uso: un paso por tarjeta, con su texto y una réplica que se toca
 * sola y cambia de estado. Se abre desde el signo "?" del inicio.
 */
class AyudaActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_ayuda)
        Responsivo.raiz(this)?.let { Responsivo.centrarHijos(it, Responsivo.ANCHO_PANEL_DP) }
        findViewById<View>(R.id.ayuda_volver).setOnClickListener { finish() }
        val pasos = findViewById<LinearLayout>(R.id.ayuda_pasos)
        val titulos = resources.getStringArray(R.array.ayuda_titulos)
        val textos = resources.getStringArray(R.array.ayuda_textos)
        titulos.forEachIndexed { i, titulo ->
            pasos.addView(tarjeta(i + 1, titulo, textos[i], demoDe(i), if (i == 3) listaDeTipos() else null))
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun color(id: Int) = getColor(id)

    private val total by lazy { resources.getStringArray(R.array.ayuda_titulos).size }

    private fun tarjeta(numero: Int, titulo: String, texto: String, demo: View, extra: View?): View {
        val caja = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.ds_surface)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
        }
        val cabecera = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        cabecera.addView(TextView(this).apply {
            text = numero.toString()
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.ds_paso_ayuda)
            setTextColor(color(R.color.white))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTypeface(typeface, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(dp(34), dp(34))
        })
        val titulos = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) }
        }
        titulos.addView(TextView(this).apply {
            text = getString(R.string.ayuda_paso_fmt, numero, total)
            setTextColor(color(R.color.primary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            setTypeface(typeface, Typeface.BOLD)
        })
        titulos.addView(TextView(this).apply {
            text = titulo
            setTextColor(color(R.color.text_primary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, Typeface.BOLD)
        })
        cabecera.addView(titulos)
        caja.addView(cabecera)
        caja.addView(TextView(this).apply {
            text = texto
            setTextColor(color(R.color.text_secondary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(0, dp(8), 0, dp(10))
        })
        caja.addView(FrameLayout(this).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(color(R.color.primary_soft))
            }
            setPadding(dp(10), dp(10), dp(10), dp(10))
            addView(demo, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        })
        extra?.let { caja.addView(it) }
        return caja
    }

    /** Lista de tipos con su regla: cada uno en una línea, con el nombre en negrita. */
    private fun listaDeTipos(): View {
        val lista = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(12), 0, 0)
        }
        resources.getStringArray(R.array.ayuda_tipos).forEach { linea ->
            val nombre = linea.substringBefore(':')
            val resto = linea.substringAfter(':', "")
            lista.addView(TextView(this).apply {
                text = android.text.SpannableStringBuilder(nombre).apply {
                    setSpan(android.text.style.StyleSpan(Typeface.BOLD), 0, nombre.length, 0)
                    append(":").append(resto)
                }
                setTextColor(color(R.color.text_secondary))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(0, dp(3), 0, dp(3))
            })
        }
        return lista
    }

    // ── Piezas de las réplicas: mismos fondos, colores y textos que la app ──

    private fun texto(valor: CharSequence, sp: Float, colorRes: Int, negrita: Boolean = false) = TextView(this).apply {
        text = valor
        setTextColor(color(colorRes))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (negrita) setTypeface(typeface, Typeface.BOLD)
    }

    private fun boton(valor: CharSequence, fondo: Int, colorRes: Int = R.color.white, alto: Int = 48, sp: Float = 15f) =
        texto(valor, sp, colorRes, negrita = true).apply {
            gravity = Gravity.CENTER
            maxLines = 1
            setBackgroundResource(fondo)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(alto)).apply { topMargin = dp(8) }
        }

    private fun columna(vararg hijos: View, tarjeta: Boolean = false) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        if (tarjeta) {
            setBackgroundResource(R.drawable.ds_surface)
            setPadding(dp(12), dp(10), dp(12), dp(12))
        }
        hijos.forEach { addView(it) }
    }

    /** Tarjeta de la jornada del inicio: saludo, estado y tiempo. */
    private fun tarjetaJornada(estado: Int, fondoEstado: Int, tiempo: String): View {
        val fila = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(texto(getString(R.string.saludo_dia), 14f, R.color.text_primary, true), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(texto(getString(estado), 11.5f, R.color.white, true).apply {
                setBackgroundResource(fondoEstado)
                setPadding(dp(10), dp(4), dp(10), dp(4))
            })
        }
        return columna(fila, texto(tiempo, 21f, R.color.text_primary, true), tarjeta = true)
    }

    /** Tarjeta de actividad del inicio: sin actividad, o "Actividad en curso" en marino. */
    private fun tarjetaActividad(resumen: String, detalle: String, enCurso: Boolean) = if (enCurso) {
        columna(
            texto(getString(R.string.act_home_en_curso), 11f, R.color.white, true).apply { alpha = 0.75f },
            texto(resumen, 18f, R.color.white, true),
            texto(detalle, 12f, R.color.white).apply { alpha = 0.8f },
            boton(getString(R.string.crono_finalizar), R.drawable.ds_button_primary, alto = 40, sp = 14f),
        ).apply {
            setBackgroundResource(R.drawable.ds_tarjeta_marino)
            setPadding(dp(12), dp(10), dp(12), dp(12))
        }
    } else {
        columna(
            texto(getString(R.string.act_home_etiqueta), 11f, R.color.text_secondary, true),
            texto(resumen, 15f, R.color.text_primary, true),
            texto(detalle, 12f, R.color.text_secondary),
            boton(getString(R.string.crono_iniciar), R.drawable.ds_boton_marino, alto = 40, sp = 14f),
            tarjeta = true,
        )
    }

    /** Las seis fichas de tipo del formulario, con la elegida llena de su color. */
    private fun fichasDeTipo(elegido: TipoActividad): View {
        val orden = listOf(
            TipoActividad.VISITA, TipoActividad.ALMUERZO, TipoActividad.NOVEDAD,
            TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.VACACIONES,
        )
        val caja = columna(texto(getString(R.string.crono_que), 13f, R.color.text_primary, true), tarjeta = true)
        orden.chunked(3).forEach { grupo ->
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
            }
            grupo.forEachIndexed { c, t ->
                val marcada = t == elegido
                fila.addView(
                    texto(t.etiqueta, 11.5f, if (marcada) R.color.white else R.color.text_primary, true).apply {
                        gravity = Gravity.CENTER
                        maxLines = 2
                        background = GradientDrawable().apply {
                            cornerRadius = dp(12).toFloat()
                            setColor(color(if (marcada) t.color() else R.color.surface))
                            setStroke(dp(1), color(if (marcada) t.color() else R.color.line))
                        }
                    },
                    LinearLayout.LayoutParams(0, dp(40), 1f).apply { if (c < 2) marginEnd = dp(6) },
                )
            }
            caja.addView(fila)
        }
        caja.addView(
            texto(resources.getStringArray(R.array.crono_tipos_ayuda)[orden.indexOf(elegido)], 12f, R.color.text_secondary).apply { setPadding(0, dp(6), 0, 0) },
        )
        return caja
    }

    /** Trozo de la regla de horas del cronograma: 10:00 a 12:00. */
    private fun regla(marcaInicio: Boolean, bloque: Boolean): View {
        val alto = 34
        val caja = FrameLayout(this).apply {
            setBackgroundResource(R.drawable.ds_surface)
            minimumHeight = dp(alto * 2 + 24)
        }
        listOf("10:00", "11:00", "12:00").forEachIndexed { i, hora ->
            caja.addView(texto(hora, 10.5f, R.color.text_tertiary), FrameLayout.LayoutParams(dp(40), dp(14)).apply { topMargin = dp(6 + i * alto); marginStart = dp(8) })
            caja.addView(View(this).apply { setBackgroundColor(color(R.color.line)) }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(12 + i * alto); marginStart = dp(50); marginEnd = dp(8) })
        }
        if (marcaInicio) {
            caja.addView(
                texto(getString(R.string.crono_inicio_marcado_fmt, "10:00"), 11.5f, R.color.primary, true).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(8), 0, dp(8), 0)
                    background = GradientDrawable().apply {
                        cornerRadius = dp(8).toFloat()
                        setColor(color(R.color.primary_soft))
                        setStroke(dp(1), color(R.color.primary))
                    }
                },
                FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(24)).apply { topMargin = dp(14); marginStart = dp(54); marginEnd = dp(8) },
            )
        }
        if (bloque) {
            caja.addView(
                texto("Visita · Coral Río  10:00 – 11:30", 11.5f, R.color.text_primary, true).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(10), 0, dp(8), 0)
                    background = GradientDrawable().apply {
                        cornerRadius = dp(8).toFloat()
                        setColor(color(TipoActividad.VISITA.fondo()))
                        setStroke(dp(1), color(TipoActividad.VISITA.color()))
                    }
                },
                FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(alto * 3 / 2 - 2)).apply { topMargin = dp(13); marginStart = dp(54); marginEnd = dp(8) },
            )
        }
        return caja
    }

    /** Franja de avisos del inicio: roja mientras falta algo, verde al arreglarse. */
    private fun aviso(valor: Int, verde: Boolean) = texto(getString(valor), 12.5f, if (verde) R.color.ok else R.color.primary, true).apply {
        gravity = Gravity.CENTER
        setBackgroundResource(if (verde) R.drawable.ds_ok_aviso else R.drawable.ds_surface)
        setPadding(dp(10), dp(12), dp(10), dp(12))
    }

    /** Botón Actualizar: [avance] de 0 a 10000 llena el fondo como en la app. */
    private fun actualizar(valor: String, avance: Int, colorRes: Int) = boton(valor, R.drawable.bg_update_progress, colorRes, alto = 44, sp = 12.5f).apply {
        (background.mutate() as? android.graphics.drawable.LayerDrawable)?.findDrawableByLayerId(R.id.progress_fill)?.level = avance
    }

    private fun cuadro(vista: () -> View) = DemoEscena.Cuadro(vista = vista)
    private fun toque(x: Float, y: Float, vista: () -> View) = DemoEscena.Cuadro(x, y, vista)

    /** Réplica de cada paso, en el mismo orden que los textos de la guía. */
    private fun demoDe(i: Int): View = when (i) {
        0 -> DemoEscena(this, listOf(
            cuadro { columna(tarjetaJornada(R.string.pill_disabled, R.drawable.bg_pill_gray, getString(R.string.journey_none_banner)), boton(getString(R.string.journey_start_upper), R.drawable.bg_button_green)) },
            toque(0.5f, 0.8f) { columna(tarjetaJornada(R.string.pill_online, R.drawable.bg_pill_green, "0 min"), boton(getString(R.string.journey_stop_upper), R.drawable.bg_button_primary)) },
        ))
        // El aviso real: magenta, con su icono, colgado del borde de arriba.
        1 -> DemoControl(
            this,
            listOf(
                DemoControl.Marco(getString(R.string.update_banner_text), color(R.color.primary), color(R.color.white)),
                DemoControl.Marco(getString(R.string.ayuda_demo_descargando), color(R.color.primary), color(R.color.white), tocar = true),
                DemoControl.Marco(getString(R.string.ayuda_demo_instalando), color(R.color.primary), color(R.color.white)),
            ),
            icono = R.drawable.ic_update,
            comoAviso = true,
        )
        2 -> DemoEscena(this, listOf(
            cuadro { tarjetaActividad(getString(R.string.crono_home_ninguna), getString(R.string.crono_home_vacio), enCurso = false) },
            toque(0.5f, 0.8f) { tarjetaActividad("Coral Río", getString(R.string.act_home_desde_fmt, "Visita", "10:00"), enCurso = true) },
            toque(0.5f, 0.8f) { tarjetaActividad(getString(R.string.crono_home_ninguna), getString(R.string.crono_home_terminado_una), enCurso = false) },
        ))
        3 -> DemoEscena(this, listOf(
            cuadro { fichasDeTipo(TipoActividad.VISITA) },
            toque(0.5f, 0.36f) { fichasDeTipo(TipoActividad.ALMUERZO) },
            toque(0.83f, 0.66f) { fichasDeTipo(TipoActividad.VACACIONES) },
            toque(0.17f, 0.36f) { fichasDeTipo(TipoActividad.VISITA) },
        ))
        4 -> DemoEscena(this, listOf(
            cuadro { regla(marcaInicio = false, bloque = false) },
            toque(0.6f, 0.26f) { regla(marcaInicio = true, bloque = false) },
            toque(0.6f, 0.62f) { regla(marcaInicio = false, bloque = true) },
        ))
        5 -> DemoEscena(this, listOf(
            cuadro { columna(texto(getString(R.string.ayuda_demo_ayer), 14f, R.color.text_primary, true), texto(getString(R.string.crono_dia_por_cerrar), 12f, R.color.text_secondary), tarjeta = true) },
            cuadro { columna(texto(getString(R.string.ayuda_demo_ayer), 14f, R.color.text_primary, true), texto(getString(R.string.crono_dia_cerrado), 12f, R.color.text_secondary), tarjeta = true) },
        ))
        6 -> DemoEscena(this, listOf(
            cuadro { actualizar(getString(R.string.refresh_button), 0, R.color.navy) },
            toque(0.5f, 0.6f) { actualizar(getString(R.string.refresh_step_sending), 6000, R.color.white) },
            cuadro { actualizar(getString(R.string.refresh_summary_ok), 10000, R.color.white) },
            cuadro { actualizar(getString(R.string.refresh_cooldown_fmt, 30), 0, R.color.text_secondary) },
        ))
        7 -> DemoEscena(this, listOf(
            cuadro { aviso(R.string.permission_warning_location, verde = false) },
            toque(0.5f, 0.5f) { aviso(R.string.aviso_ok_ubicacion, verde = true) },
        ))
        else -> DemoEscena(this, listOf(
            cuadro { boton(getString(R.string.journey_stop_upper), R.drawable.bg_button_primary) },
            toque(0.5f, 0.6f) { boton(getString(R.string.journey_confirm_tap), R.drawable.bg_button_primary) },
            toque(0.5f, 0.6f) { boton(getString(R.string.journey_start_upper), R.drawable.bg_button_green) },
        ))
    }
}

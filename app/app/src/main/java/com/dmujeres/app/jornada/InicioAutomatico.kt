package com.dmujeres.app.jornada

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.avisos.AvisosDelDia
import com.dmujeres.app.cronograma.Actividades
import com.dmujeres.app.cronograma.HoraCronograma
import com.dmujeres.app.red.DmujeresApi
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Inicia la jornada 1 h antes de la primera visita o almuerzo del cronograma
 * (ver [ReglasJornada]). Lo dispara una alarma exacta del propio teléfono, así
 * funciona sin internet. Una vez por día: si la persona la cierra después, no
 * se vuelve a abrir sola.
 */
object InicioAutomatico {

    private const val TAG = "InicioAutomatico"
    private const val ACCION = "com.dmujeres.app.action.INICIO_JORNADA"
    private const val CODIGO = 9
    private const val KEY_HECHO = "inicioAutoHecho"
    const val KEY_PROXIMO = "inicioAutoProximo"
    const val KEY_ULTIMO = "inicioAutoUltimo"
    private val zona: TimeZone = TimeZone.getTimeZone("America/Guayaquil")

    /** Si toca, inicia la jornada ahora; después deja armada la próxima alarma. */
    fun revisar(context: Context) {
        runCatching {
            val prefs = PreferenceManager.getDefaultSharedPreferences(context)
            val ahora = Calendar.getInstance(zona)
            val hoy = fecha(ahora)
            val minuto = ahora.get(Calendar.HOUR_OF_DAY) * 60 + ahora.get(Calendar.MINUTE)
            if (prefs.getString(KEY_HECHO, null) != hoy && ReglasJornada.tocaIniciar(horas(context, hoy), minuto)) {
                prefs.edit().putString(KEY_HECHO, hoy).apply()
                val yaAbierta = DmujeresApi.isJourneyOpen(context)
                val resultado = when {
                    yaAbierta -> "ya estaba iniciada"
                    DmujeresApi.iniciarJornada(context, "cronograma") -> "jornada iniciada"
                    else -> "no se pudo: falta ubicación todo el tiempo"
                }
                prefs.edit().putString(KEY_ULTIMO, "$hoy ${HoraCronograma.legible(hora(minuto))} · $resultado").apply()
            }
            programar(context, ahora)
        }.onFailure { Log.w(TAG, "no se pudo revisar el inicio automático", it) }
    }

    /** Arma la alarma del próximo inicio (hoy o en los próximos días con cronograma). */
    private fun programar(context: Context, ahora: Calendar) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val dia = ahora.clone() as Calendar
        for (d in 0..7) {
            val fecha = fecha(dia)
            val inicio = ReglasJornada.minutoDeInicio(horas(context, fecha))
            if (inicio != null && !(d == 0 && prefs.getString(KEY_HECHO, null) == fecha)) {
                val cuando = (dia.clone() as Calendar).apply {
                    set(Calendar.HOUR_OF_DAY, inicio / 60)
                    set(Calendar.MINUTE, inicio % 60)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                if (cuando > ahora.timeInMillis) {
                    AvisosDelDia.armar(context, CODIGO, Intent(context.applicationContext, Receptor::class.java).setAction(ACCION), cuando)
                    prefs.edit().putLong(KEY_PROXIMO, cuando).apply()
                    return
                }
            }
            dia.add(Calendar.DAY_OF_MONTH, 1)
        }
        prefs.edit().remove(KEY_PROXIMO).apply()
    }

    private fun horas(context: Context, fecha: String): List<Int> =
        Actividades.delDia(context, fecha).filter { it.tipo in ReglasJornada.DE_RUTA }.map { HoraCronograma.aMinutos(it.hora) }

    private fun fecha(c: Calendar): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zona }.format(c.time)

    private fun hora(minuto: Int) = "%02d:%02d".format(minuto / 60, minuto % 60)

    class Receptor : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == ACCION) revisar(context)
        }
    }
}

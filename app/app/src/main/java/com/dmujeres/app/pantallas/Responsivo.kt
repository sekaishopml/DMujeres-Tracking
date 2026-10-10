package com.dmujeres.app.pantallas

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import kotlin.math.roundToInt

/**
 * Adaptación a tablets (ancho mínimo de 600 dp o más).
 *
 * - Teléfono y tablet se quedan en vertical: las pantallas están pensadas
 *   para ese formato y en horizontal no caben.
 * - En tablet el contenido no se estira de borde a borde: se centra con un
 *   ancho máximo agregando margen interno a los lados. Las cabeceras y los
 *   pies conservan su fondo a todo el ancho; solo su contenido se centra.
 */
object Responsivo {

    /** Formularios y pantallas de una columna. */
    const val ANCHO_COLUMNA_DP = 600

    /** Listas y paneles con más información por fila. */
    const val ANCHO_PANEL_DP = 760

    fun esTablet(context: Context): Boolean =
        context.resources.configuration.smallestScreenWidthDp >= 600

    fun fijarOrientacion(activity: Activity) {
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }

    /** Margen extra a cada lado para que el contenido mida como mucho [maxDp]. */
    fun margenLateralPx(context: Context, maxDp: Int): Int {
        if (!esTablet(context)) return 0
        val ancho = context.resources.configuration.screenWidthDp
        if (ancho <= maxDp) return 0
        return ((ancho - maxDp) / 2f * context.resources.displayMetrics.density).roundToInt()
    }

    /** Centra el contenido de [vista] (su fondo sigue a todo el ancho). */
    fun centrar(vista: View, maxDp: Int = ANCHO_COLUMNA_DP) {
        val extra = margenLateralPx(vista.context, maxDp)
        if (extra == 0) return
        vista.setPaddingRelative(
            vista.paddingStart + extra, vista.paddingTop, vista.paddingEnd + extra, vista.paddingBottom,
        )
    }

    /** Centra cada hijo directo: cabecera, cuerpo y pie con su fondo entero. */
    fun centrarHijos(grupo: ViewGroup, maxDp: Int = ANCHO_COLUMNA_DP) {
        if (margenLateralPx(grupo.context, maxDp) == 0) return
        for (i in 0 until grupo.childCount) centrar(grupo.getChildAt(i), maxDp)
    }

    /** Raíz del layout de la actividad (lo que se pasó a setContentView). */
    fun raiz(activity: Activity): ViewGroup? =
        activity.findViewById<ViewGroup>(android.R.id.content)?.getChildAt(0) as? ViewGroup
}

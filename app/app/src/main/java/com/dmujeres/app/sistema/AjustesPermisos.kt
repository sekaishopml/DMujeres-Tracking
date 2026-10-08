package com.dmujeres.app.sistema

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Permisos de la app y a dónde llevar a la persona para arreglarlos. La
 * ubicación "todo el tiempo" no se concede con un cuadro: hay que elegirla en
 * Ajustes, así que se abre directo la página de permiso de ubicación de la app.
 */
object AjustesPermisos {
    private const val ACCION_PERMISO_DE_APP = "android.intent.action.MANAGE_APP_PERMISSION"
    private const val GRUPO_UBICACION = "android.permission-group.LOCATION"

    fun concedido(context: Context, permiso: String): Boolean =
        ContextCompat.checkSelfPermission(context, permiso) == PackageManager.PERMISSION_GRANTED

    fun ubicacion(context: Context) = concedido(context, Manifest.permission.ACCESS_FINE_LOCATION)

    /** Ubicación "todo el tiempo": solo existe desde Android 10. */
    fun ubicacionSiempre(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            concedido(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    /** Pasos y actividad física: se pide desde Android 10. */
    fun actividadFisica(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            concedido(context, Manifest.permission.ACTIVITY_RECOGNITION)

    /**
     * Lleva a Permisos > Ubicación de esta app, donde se elige "Permitir todo
     * el tiempo". Primero la página directa; si el teléfono no la ofrece, la
     * ficha de la app.
     */
    fun abrirUbicacion(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val directa = Intent(ACCION_PERMISO_DE_APP)
                .putExtra(Intent.EXTRA_PACKAGE_NAME, activity.packageName)
                .putExtra("android.intent.extra.PERMISSION_NAME", Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                .putExtra("android.intent.extra.PERMISSION_GROUP_NAME", GRUPO_UBICACION)
                .putExtra(Intent.EXTRA_USER, android.os.Process.myUserHandle())
            if (runCatching { activity.startActivity(directa) }.isSuccess) return
        }
        abrirFichaDeLaApp(activity)
    }

    fun abrirFichaDeLaApp(context: Context) {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}

package com.dmujeres.app.sistema

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Pantallas de "inicio automático" de fabricantes que la librería
 * AutoStarter no cubre. Transsion (Infinix, Tecno, itel) es la marca más
 * común en la flota y su Phone Master congela apps en segundo plano: sin este
 * permiso el servicio deja de recibir ubicaciones con la pantalla apagada.
 */
object OemAutostart {

    private val TRANSSION = listOf(
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.widget.activity.MainSettingGpActivity"),
        ComponentName("com.itel.autobootmanager", "com.itel.autobootmanager.activity.AutoBootMgrActivity"),
    )

    /** Abre la pantalla del fabricante si existe; true si se abrió alguna. */
    fun open(context: Context): Boolean {
        for (component in TRANSSION) {
            val intent = Intent().setComponent(component).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) == null) continue
            if (runCatching { context.startActivity(intent) }.isSuccess) return true
        }
        return false
    }
}

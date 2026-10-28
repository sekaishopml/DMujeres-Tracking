package com.dmujeres.app.sistema

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.judemanutd.autostarter.AutoStartPermissionHelper

/**
 * Ajustes propios de cada fabricante que deciden si la app sigue viva con la
 * pantalla apagada. Ninguno tiene API pública: se abren sus pantallas y, si
 * no existen en esa versión, la ficha de la app, donde están los mismos
 * interruptores. Detalle por marca en docs/permisos-por-marca.md.
 */
object OemAutostart {

    enum class Marca { XIAOMI, HUAWEI, HONOR, SAMSUNG, TRANSSION, OTRA }

    fun marca(): Marca = marcaDe(Build.MANUFACTURER, Build.BRAND)

    fun marcaDe(fabricante: String?, marca: String?): Marca {
        val nombres = listOf(fabricante, marca).map { it.orEmpty().lowercase() }
        fun hay(vararg claves: String) = nombres.any { n -> claves.any { n.contains(it) } }
        return when {
            hay("xiaomi", "redmi", "poco") -> Marca.XIAOMI
            hay("honor") -> Marca.HONOR
            hay("huawei") -> Marca.HUAWEI
            hay("samsung") -> Marca.SAMSUNG
            hay("infinix", "tecno", "itel") -> Marca.TRANSSION
            else -> Marca.OTRA
        }
    }

    fun esXiaomi(): Boolean = marca() == Marca.XIAOMI

    private val TRANSSION = listOf(
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.widget.activity.MainSettingGpActivity"),
        ComponentName("com.itel.autobootmanager", "com.itel.autobootmanager.activity.AutoBootMgrActivity"),
    )

    // "Inicio de apps": Honor (MagicOS) cambió el paquete; los Honor viejos
    // y los Huawei usan el de Huawei.
    private val INICIO_DE_APPS = listOf(
        ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
    )

    /** Operación de AppOps de Xiaomi para "Inicio automático" (no está en el SDK). */
    private const val OP_INICIO_AUTOMATICO_XIAOMI = 10008

    /**
     * Xiaomi (MIUI/HyperOS): ¿la app tiene "Inicio automático"? Sin él, el
     * sistema la cierra y no la deja volver (ni alarma ni aviso push la
     * reviven). null si no es Xiaomi o el sistema no deja leerlo.
     */
    fun inicioAutomaticoXiaomi(context: Context): Boolean? {
        if (!esXiaomi()) return null
        return runCatching {
            val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val metodo = AppOpsManager::class.java.getMethod(
                "checkOpNoThrow", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java,
            )
            metodo.invoke(ops, OP_INICIO_AUTOMATICO_XIAOMI, Process.myUid(), context.packageName) as Int ==
                AppOpsManager.MODE_ALLOWED
        }.getOrNull()
    }

    /**
     * Xiaomi: ¿"Ahorro de batería: Sin restricciones"? Es lo único que libra a
     * la app del congelador de HyperOS, que la detiene segundos después de
     * apagar la pantalla aunque tenga servicio en primer plano. El sistema
     * guarda la lista en un ajuste propio; si no deja leerlo, null.
     */
    fun sinRestriccionXiaomi(context: Context): Boolean? {
        if (!esXiaomi()) return null
        return runCatching {
            Settings.System.getString(context.contentResolver, "MILLET_NO_RESTRICT_APP")
                ?.contains(context.packageName)
        }.getOrNull()
    }

    /** Inicio automático: Xiaomi, Transsion y lo que cubra la librería. */
    fun hayInicioAutomatico(context: Context): Boolean =
        marca() == Marca.XIAOMI || marca() == Marca.TRANSSION ||
            runCatching { AutoStartPermissionHelper.getInstance().isAutoStartPermissionAvailable(context, false) }
                .getOrDefault(false)

    /** Abre la pantalla de inicio automático; true si se abrió alguna. */
    fun open(context: Context): Boolean {
        if (abrir(context, TRANSSION.map { Intent().setComponent(it) })) return true
        return runCatching { AutoStartPermissionHelper.getInstance().getAutoStartPermission(context, true, true) }
            .getOrDefault(false)
    }

    /** Xiaomi: la pantalla de ahorro de batería de la app ("Sin restricciones"). */
    fun abrirAhorroXiaomi(context: Context): Boolean {
        val etiqueta = context.applicationInfo.loadLabel(context.packageManager).toString()
        val directa = Intent()
            .setComponent(ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
            .putExtra("package_name", context.packageName)
            .putExtra("package_label", etiqueta)
        return abrir(context, listOf(directa)) || abrirFicha(context)
    }

    /** Huawei y Honor: "Inicio de apps", donde se pasa la app a manual. */
    fun abrirInicioDeApps(context: Context): Boolean =
        abrir(context, INICIO_DE_APPS.map { Intent().setComponent(it) }) || abrirFicha(context)

    /** Samsung: "Apps que nunca se suspenden" (enlace documentado por Samsung). */
    fun abrirNuncaSuspender(context: Context): Boolean {
        val lista = Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
            .setPackage("com.samsung.android.lool")
            .putExtra("activity_type", 2)
        return abrir(context, listOf(lista)) || abrirFicha(context)
    }

    private fun abrirFicha(context: Context): Boolean = abrir(
        context,
        listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))),
    )

    private fun abrir(context: Context, intents: List<Intent>): Boolean {
        for (intent in intents) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) == null) continue
            if (runCatching { context.startActivity(intent) }.isSuccess) return true
        }
        return false
    }
}

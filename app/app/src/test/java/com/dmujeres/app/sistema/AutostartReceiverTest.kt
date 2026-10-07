package com.dmujeres.app.sistema

import android.content.Intent
import android.os.Build
import androidx.preference.PreferenceManager
import androidx.test.core.app.ApplicationProvider
import com.dmujeres.app.datos.DatabaseHelper
import com.dmujeres.app.datos.Prefs
import com.dmujeres.app.red.DmujeresApi
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Arranque en boot (Robolectric).
 *
 * - Sin jornada ni STATUS, el receiver no tumba ni arranca nada (pero rearma
 *   la alarma de rescate).
 * - El arranque del servicio nunca lanza al receiver (Android 12+ puede
 *   rechazarlo): se registra y se sigue.
 */
@Config(application = com.dmujeres.app.sistema.MainApplication::class,
    sdk = [Build.VERSION_CODES.P])
@RunWith(RobolectricTestRunner::class)
class AutostartReceiverTest {

    @Test
    fun `sin STATUS no arranca y no deja marca de recuperacion`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putBoolean(Prefs.STATUS, false)
            .putBoolean(DmujeresApi.KEY_JOURNEY_OPEN, false)
            .apply()
        // No debe lanzar (antes el start sin guarda podía tumbar el receiver).
        AutostartReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))
        assertNull(DatabaseHelper(context).getMeta(DatabaseHelper.KEY_RECOVERY_PENDING))
    }

    @Test
    fun `con jornada abierta deja marca de recuperacion sin tumbar`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putBoolean(Prefs.STATUS, false)
            .putBoolean(DmujeresApi.KEY_JOURNEY_OPEN, true)
            .apply()
        AutostartReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))
        // El próximo arranque entra en RECOVERING y reconcilia con el servidor.
        org.junit.Assert.assertEquals(
            "1",
            DatabaseHelper(context).getMeta(DatabaseHelper.KEY_RECOVERY_PENDING),
        )
    }
}

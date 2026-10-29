package com.dmujeres.app.avisos

import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import com.dmujeres.app.R

/**
 * Sonido propio de los avisos de la app: dos notas graves y cálidas (Sol y Re)
 * (res/raw/dmj_aviso.wav), para reconocerlos entre las demás notificaciones.
 * En Android 8+ lo lleva el canal; antes, cada notificación.
 */
object SonidoAvisos {

    fun uri(context: Context): Uri = Uri.parse("android.resource://${context.packageName}/${R.raw.dmj_aviso}")

    val atributos: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    /** Lo hace sonar una vez (Depuración). */
    fun probar(context: Context) {
        runCatching { RingtoneManager.getRingtone(context, uri(context))?.play() }
    }
}

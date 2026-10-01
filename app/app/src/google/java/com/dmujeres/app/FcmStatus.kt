package com.dmujeres.app

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit

/** Implementación real para el flavor `google` (Firebase incluido). */
object FcmStatus {
    fun hasToken(context: Context): Boolean? = runCatching {
        val token = Tasks.await(FirebaseMessaging.getInstance().token, 3, TimeUnit.SECONDS)
        token.isNotBlank()
    }.getOrNull()
}

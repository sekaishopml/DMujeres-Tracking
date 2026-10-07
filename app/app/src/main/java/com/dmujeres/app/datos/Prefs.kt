package com.dmujeres.app.datos

/**
 * Claves de la configuración interna de la app.
 *
 * No hay pantalla de ajustes: la configuración llega del servidor y solo el
 * menú de depuración (5 toques en la versión) permite verla o cambiarla.
 */
object Prefs {

    const val DEVICE = "id"
    const val URL = "url"
    /** Identificador de esta instalación; cambia si se reinstala la app. */
    const val INSTALL_ID = "installId"
    const val INTERVAL = "interval"
    const val DISTANCE = "distance"
    const val ANGLE = "angle"
    const val ACCURACY = "accuracy"
    const val STATUS = "status"
    const val ONBOARDED = "onboarded"
    /** Hora en que se completó el asistente (repara la marca si se perdió). */
    const val ONBOARDED_AT = "onboardedAt"
    const val BUFFER = "buffer"
    const val WAKELOCK = "wakelock"

    /** Último fix marcado como GPS falso (mock), para el diagnóstico. */
    const val LAST_MOCK = "lastMock"

    /** Contador de despertares de recuperación (alarma/FCM/boot). */
    const val RECOVERY_COUNT = "recoveryCount"

    /** Último estado de la máquina de movimiento (para el latido). */
    const val MOVEMENT_STATE = "movementState"

    /**
     * ¿El avance acumulado indica caminata? Se persiste en cada fix para que
     * el latido lo reporte sin depender de la RAM del servicio.
     */
    const val MOVEMENT_WALKING = "movementWalking"

    /**
     * Modo de desplazamiento para el panel (`caminata` o `normal`): distingue
     * en el diagnóstico un paseo a pie de un trayecto en vehículo, ambos en
     * cadencia fina.
     */
    const val MOVEMENT_MODE = "movementMode"
    const val MODE_WALK = "caminata"
    const val MODE_NORMAL = "normal"
}

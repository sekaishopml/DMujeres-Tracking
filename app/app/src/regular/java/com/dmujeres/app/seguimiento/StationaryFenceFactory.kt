package com.dmujeres.app.seguimiento

import android.content.Context

object StationaryFenceFactory {

    fun create(context: Context): StationaryFence = NoStationaryFence
}

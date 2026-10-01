package com.dmujeres.app

import android.content.Context

object StationaryFenceFactory {

    fun create(context: Context): StationaryFence = NoStationaryFence
}

package com.amethos.mytechkid

import android.content.Context
import android.hardware.display.DisplayManager
import android.util.DisplayMetrics
import android.view.Display

/**
 * The whole screen in real pixels, status and navigation bars included, in
 * its current direction. Screen sharing captures exactly this area and the
 * helper's taps are placed on it, so both must use the same measure.
 */
fun realScreenSize(context: Context): Pair<Int, Int> {
    val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    val m = DisplayMetrics()
    @Suppress("DEPRECATION")
    display.getRealMetrics(m)
    return m.widthPixels to m.heightPixels
}

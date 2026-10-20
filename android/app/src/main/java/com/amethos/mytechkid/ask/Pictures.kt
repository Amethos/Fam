package com.amethos.mytechkid.ask

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.util.UUID

/**
 * Pictures of Mom's screen waiting for her "Send" tap. They're shrunk and
 * re-saved as a fresh JPEG, so nothing hidden (location, camera details)
 * leaves the phone, and they're kept only in the app's own cache.
 */
object Pictures {
    private const val MAX_SIDE = 1600
    private const val QUALITY = 80
    private val NAME = Regex("[a-z0-9-]{1,40}\\.jpg")

    private fun dir(context: Context) = File(context.cacheDir, "scam-pictures").apply { mkdirs() }

    /** Only our own files, by name: a name from outside can't point anywhere else. */
    fun file(context: Context, name: String): File? =
        if (NAME.matches(name)) File(dir(context), name).takeIf { it.isFile } else null

    fun save(context: Context, bitmap: Bitmap): File {
        cleanup(context)
        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(bitmap.width, bitmap.height))
        val small = if (scale < 1f) {
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        } else {
            bitmap
        }
        val file = File(dir(context), "${UUID.randomUUID()}.jpg")
        file.outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
        if (small !== bitmap) small.recycle()
        return file
    }

    /** A screenshot or picture shared to My Tech Kid, or picked in the photo picker. */
    fun fromUri(context: Context, uri: Uri): File? {
        val bitmap = try {
            if (Build.VERSION.SDK_INT >= 28) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    val side = maxOf(info.size.width, info.size.height)
                    if (side > MAX_SIDE) {
                        val s = MAX_SIDE.toFloat() / side
                        decoder.setTargetSize((info.size.width * s).toInt(), (info.size.height * s).toInt())
                    }
                }
            } else {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
                context.contentResolver.openInputStream(uri)?.use {
                    BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                }
            }
        } catch (e: Exception) {
            null
        } ?: return null
        return save(context, bitmap).also { bitmap.recycle() }
    }

    /** Pictures Mom didn't send are gone after a day. */
    private fun cleanup(context: Context) {
        val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000L
        dir(context).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    /** Whether Mom (with her helper) has turned the ask button on in Android's Accessibility settings. */
    fun isAskButtonOn(context: Context): Boolean {
        val me = ComponentName(context, AskService::class.java)
        val on = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return on.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    /** The button needs Android 11 or newer (taking a picture of the screen). */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= 30
}

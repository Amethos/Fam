package com.amethos.mytechkid

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.google.firebase.FirebaseApp
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Beta updates for Mom's app, which isn't from the Play Store.
 *
 * Each build publishes `/download/version.json` next to the APK. When it names
 * a newer build, Mom sees one "Update" button; the app downloads the APK and
 * hands it to Android's own installer (TechKidViewModel.startUpdate). Android only accepts it as an update if
 * it is signed with the same key as the installed app, so a swapped file
 * can't replace My Tech Kid.
 */
object Updater {
    private const val APK = "download/mytechkid-beta.apk"
    private const val VERSION = "download/version.json"

    private fun site(context: Context): String? {
        val projectId = FirebaseApp.getApps(context).firstOrNull()?.options?.projectId ?: return null
        return "https://$projectId.web.app/"
    }

    private fun installedVersion(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    }

    /** True when the website has a newer build than this phone. */
    suspend fun isUpdateAvailable(context: Context): Boolean = withContext(Dispatchers.IO) {
        val base = site(context) ?: return@withContext false
        val conn = open(base + VERSION)
        try {
            if (conn.responseCode != 200) return@withContext false
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            JSONObject(text).optLong("versionCode", 0) > installedVersion(context)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Downloads the new build and checks it really is a newer My Tech Kid.
     * Kept in the app's cache until it is installed, so it can be handed to
     * Android later if Mom left the app while it was downloading.
     */
    suspend fun download(context: Context): File = withContext(Dispatchers.IO) {
        val base = site(context) ?: error("No website")
        val file = apkFile(context)
        val conn = open(base + APK)
        try {
            if (conn.responseCode != 200) error("Download failed (${conn.responseCode})")
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
        } catch (e: Exception) {
            file.delete()
            throw e
        } finally {
            conn.disconnect()
        }
        downloaded(context) ?: error("Not a newer My Tech Kid")
    }

    /** The downloaded build, if there is one and it is newer than this phone's. Deletes it otherwise. */
    suspend fun downloaded(context: Context): File? = withContext(Dispatchers.IO) {
        val file = apkFile(context)
        if (!file.exists()) return@withContext null
        // Only hand over an APK that really is a newer My Tech Kid.
        val info = context.packageManager.getPackageArchiveInfo(file.path, 0)
        val version = if (Build.VERSION.SDK_INT >= 28) info?.longVersionCode else @Suppress("DEPRECATION") info?.versionCode?.toLong()
        if (info?.packageName != context.packageName || (version ?: 0) <= installedVersion(context)) {
            file.delete()
            return@withContext null
        }
        file
    }

    /** Removes any old download, e.g. once the update is installed. */
    suspend fun cleanUp(context: Context) = withContext(Dispatchers.IO) {
        File(context.cacheDir, "updates").deleteRecursively()
    }

    /**
     * Android asks once before My Tech Kid may install its own updates (Mom only
     * allowed her browser when she first installed it).
     */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Opens the one switch that lets My Tech Kid install its updates. */
    fun askToAllowInstalls(context: Context) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /** Opens Android's "Update this app?" screen. */
    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    private fun apkFile(context: Context): File =
        File(File(context.cacheDir, "updates").apply { mkdirs() }, "mytechkid.apk")

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            useCaches = false
        }
}

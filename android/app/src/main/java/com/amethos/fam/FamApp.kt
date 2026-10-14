package com.amethos.fam

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.google.firebase.FirebaseApp

class FamApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "family"

        /** True until a real google-services.json replaces the placeholder (docs/SETUP.md). */
        fun isPlaceholderConfig(context: android.content.Context): Boolean {
            val projectId = FirebaseApp.getApps(context).firstOrNull()?.options?.projectId
            return projectId == null || projectId == "fam-placeholder"
        }
    }
}

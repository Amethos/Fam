package com.amethos.mytechkid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** Who is ringing Mom's phone right now, or null. Read by ui/Screens.kt. */
object RingState {
    var ringingFrom by mutableStateOf<String?>(null)
        internal set
}

/**
 * "Ring Mom's phone": a helper in her family can make it play loudly for 30
 * seconds, even on silent, so she can find it. The notification always says
 * who is ringing, and "Found it" stops it.
 */
class RingService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var savedVolume: Int? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRinging()
            return START_NOT_STICKY
        }
        val helper = intent?.getStringExtra(EXTRA_HELPER)?.take(60)?.ifBlank { null } ?: "Your family"
        val notification = notification(helper)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        RingState.ringingFrom = helper
        if (player == null) startSound()
        main.removeCallbacksAndMessages(null)
        main.postDelayed({ stopRinging() }, RING_MS)
        return START_NOT_STICKY
    }

    private fun startSound() {
        val audio = getSystemService(AudioManager::class.java)
        // The alarm sound plays even when the ringer is on silent. Turn it all
        // the way up while ringing, then put it back.
        savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        runCatching {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        }
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(this@RingService, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
        val vibrator = getSystemService(Vibrator::class.java)
        vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0))
    }

    private fun stopRinging() {
        main.removeCallbacksAndMessages(null)
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
        getSystemService(Vibrator::class.java)?.cancel()
        savedVolume?.let { v ->
            runCatching { getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, v, 0) }
        }
        savedVolume = null
        RingState.ringingFrom = null
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (player != null) stopRinging()
        super.onDestroy()
    }

    private fun notification(helper: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        // The sound comes from the player above, so the notification itself is silent.
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.ring_channel_name), NotificationManager.IMPORTANCE_HIGH)
                .apply { setSound(null, null) },
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 2, Intent(this, RingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$helper is ringing your phone")
            .setContentText("Tap Found it to stop.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Found it", stop)
            .build()
    }

    companion object {
        private const val CHANNEL = "ring"
        private const val NOTIFICATION_ID = 43
        private const val RING_MS = 30_000L
        private const val ACTION_STOP = "com.amethos.mytechkid.STOP_RINGING"
        private const val EXTRA_HELPER = "helper"

        fun start(context: Context, helperName: String) {
            ContextCompat.startForegroundService(
                context, Intent(context, RingService::class.java).putExtra(EXTRA_HELPER, helperName),
            )
        }

        fun stop(context: Context) {
            context.startService(Intent(context, RingService::class.java).setAction(ACTION_STOP))
        }
    }
}

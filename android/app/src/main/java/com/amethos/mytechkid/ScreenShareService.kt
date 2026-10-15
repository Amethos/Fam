package com.amethos.mytechkid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import org.json.JSONObject
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.DataChannel

/** What Mom's screens show while her screen is shared. Read by ui/Screens.kt. */
object ShareState {
    /** The helper who can see the screen, "" while waiting for them, null when not sharing. */
    var watcher by mutableStateOf<String?>(null)
        internal set
    var waiting by mutableStateOf(false)
        internal set
}

/**
 * Shares Mom's screen with her helper (stage 2). Only ever started by Mom
 * tapping "Show my screen" and accepting Android's own prompt; a notification
 * with Stop shows the whole time. The picture goes phone to phone over WebRTC
 * (end-to-end encrypted); Firestore only carries the setup messages.
 * Apps that block screenshots (banking, passwords) show as black.
 */
class ScreenShareService : Service() {
    private val db = FirebaseFirestore.getInstance()
    private val main = Handler(Looper.getMainLooper())
    private var shareRef: DocumentReference? = null
    private var uid: String = ""
    private val listeners = mutableListOf<ListenerRegistration>()
    private val seen = mutableSetOf<String>()
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private var offered = false
    private var stopping = false

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var textures: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var pc: PeerConnection? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSharing(endShare = true)
            return START_NOT_STICKY
        }
        val projection = intent?.let { IntentCompat.getParcelableExtra(it, EXTRA_PROJECTION, Intent::class.java) }
        val circleId = intent?.getStringExtra(EXTRA_CIRCLE)
        val me = intent?.getStringExtra(EXTRA_UID)
        val myName = intent?.getStringExtra(EXTRA_NAME) ?: ""
        if (projection == null || circleId == null || me == null || shareRef != null) {
            if (shareRef == null) stopSelf()
            return START_NOT_STICKY
        }
        uid = me
        // Android requires the notification before the screen can be captured.
        val notification = notification("Waiting for your family to watch…")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        ShareState.watcher = ""
        ShareState.waiting = true
        try {
            startCapture(projection)
        } catch (e: Exception) {
            stopSharing(endShare = false)
            return START_NOT_STICKY
        }
        val ref = db.collection("circles/$circleId/screenShares").document()
        shareRef = ref
        ref.set(
            mapOf(
                "parentId" to me,
                "parentName" to myName.ifBlank { "Your family member" }.take(60),
                "status" to "waiting",
                "createdAt" to FieldValue.serverTimestamp(),
            ),
        ).addOnFailureListener { stopSharing(endShare = false) }
        listeners += ref.addSnapshotListener { snap, _ ->
            when (snap?.getString("status")) {
                "live" -> {
                    val helper = firstName(snap.getString("helperName") ?: "Your family")
                    ShareState.watcher = helper
                    ShareState.waiting = false
                    notify("$helper can see your screen")
                    if (!offered) {
                        offered = true
                        listenForSignals(ref)
                        makeOffer(ref)
                    }
                }
                "ended" -> stopSharing(endShare = false)
            }
        }
        // Nobody joined in time: stop on our own (the rules refuse late joins too).
        main.postDelayed({ if (ShareState.waiting) stopSharing(endShare = true) }, JOIN_WINDOW_MS)
        return START_NOT_STICKY
    }

    private fun startCapture(projection: Intent) {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions(),
        )
        val egl = EglBase.create().also { this.egl = it }
        val factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
            .also { this.factory = it }
        val capturer = ScreenCapturerAndroid(projection, object : MediaProjection.Callback() {
            // Mom stopped it from Android's own controls.
            override fun onStop() {
                main.post { stopSharing(endShare = true) }
            }
        }).also { this.capturer = it }
        val textures = SurfaceTextureHelper.create("screen", egl.eglBaseContext).also { this.textures = it }
        val source = factory.createVideoSource(true).also { this.source = it }
        capturer.initialize(textures, applicationContext, source.capturerObserver)
        // Half the screen's resolution keeps it smooth on a phone connection.
        val metrics = resources.displayMetrics
        capturer.startCapture(metrics.widthPixels / 2, metrics.heightPixels / 2, 15)

        val config = PeerConnection.RTCConfiguration(
            listOf(
                PeerConnection.IceServer.builder(listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"))
                    .createIceServer(),
            ),
        ).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                main.post { sendSignal("candidate", candidateJson(candidate)) }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onDataChannel(channel: DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
        })
        val track = factory.createVideoTrack("screen", source)
        pc?.addTrack(track, listOf("screen"))
    }

    private fun makeOffer(ref: DocumentReference) {
        val pc = pc ?: return
        pc.createOffer(object : SdpAdapter() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(object : SdpAdapter() {
                    override fun onSetSuccess() {
                        main.post { sendSignal("offer", JSONObject().put("sdp", desc.description).toString()) }
                    }
                }, desc)
            }
        }, MediaConstraints())
    }

    private fun listenForSignals(ref: DocumentReference) {
        listeners += ref.collection("signals").orderBy("createdAt").addSnapshotListener { snap, _ ->
            snap?.documents.orEmpty().forEach { d ->
                if (d.id in seen || d.getString("from") == uid) return@forEach
                seen += d.id
                val payload = runCatching { JSONObject(d.getString("payload") ?: "") }.getOrNull() ?: return@forEach
                when (d.getString("type")) {
                    "answer" -> pc?.setRemoteDescription(object : SdpAdapter() {
                        override fun onSetSuccess() {
                            main.post {
                                pendingCandidates.forEach { pc?.addIceCandidate(it) }
                                pendingCandidates.clear()
                            }
                        }
                    }, SessionDescription(SessionDescription.Type.ANSWER, payload.getString("sdp")))
                    "candidate" -> {
                        val c = IceCandidate(payload.optString("sdpMid"), payload.optInt("sdpMLineIndex"), payload.getString("candidate"))
                        if (pc?.remoteDescription != null) pc?.addIceCandidate(c) else pendingCandidates += c
                    }
                }
            }
        }
    }

    private fun sendSignal(type: String, payload: String) {
        val ref = shareRef ?: return
        if (stopping) return
        ref.collection("signals").add(
            mapOf("from" to uid, "type" to type, "payload" to payload, "createdAt" to FieldValue.serverTimestamp()),
        )
    }

    private fun candidateJson(c: IceCandidate) =
        JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).toString()

    private fun stopSharing(endShare: Boolean) {
        if (stopping) return
        stopping = true
        main.removeCallbacksAndMessages(null)
        listeners.forEach { it.remove() }
        listeners.clear()
        if (endShare) {
            shareRef?.update(mapOf("status" to "ended", "endedBy" to uid, "endedAt" to FieldValue.serverTimestamp()))
        }
        runCatching { capturer?.stopCapture() }
        pc?.close()
        pc?.dispose()
        capturer?.dispose()
        source?.dispose()
        textures?.dispose()
        factory?.dispose()
        egl?.release()
        pc = null; capturer = null; source = null; textures = null; factory = null; egl = null
        ShareState.watcher = null
        ShareState.waiting = false
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopSharing(endShare = true)
        super.onDestroy()
    }

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.share_channel_name), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(text)
            .setContentText("Tap Stop to end it at any time.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .build()
    }

    /** SdpObserver with nothing to do by default. */
    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    companion object {
        private const val CHANNEL = "screen-share"
        private const val NOTIFICATION_ID = 42
        private const val ACTION_STOP = "com.amethos.mytechkid.STOP_SHARING"
        private const val EXTRA_PROJECTION = "projection"
        private const val EXTRA_CIRCLE = "circle"
        private const val EXTRA_UID = "uid"
        private const val EXTRA_NAME = "name"
        private const val JOIN_WINDOW_MS = 10 * 60 * 1000L

        fun start(context: Context, projection: Intent, circleId: String, uid: String, name: String) {
            val intent = Intent(context, ScreenShareService::class.java)
                .putExtra(EXTRA_PROJECTION, projection)
                .putExtra(EXTRA_CIRCLE, circleId)
                .putExtra(EXTRA_UID, uid)
                .putExtra(EXTRA_NAME, name)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, ScreenShareService::class.java).setAction(ACTION_STOP))
        }
    }
}

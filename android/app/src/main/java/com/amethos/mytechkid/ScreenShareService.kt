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
import org.webrtc.RtpParameters
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.DataChannel
import com.google.firebase.Timestamp
import java.nio.ByteBuffer

/** What Mom's screens show while her screen is shared. Read by ui/Screens.kt. */
object ShareState {
    /** The helper who can see the screen, "" while waiting for them, null when not sharing. */
    var watcher by mutableStateOf<String?>(null)
        internal set
    var waiting by mutableStateOf(false)
        internal set
    /** The helper asked to tap for Mom, but her accessibility switch is still off. */
    var controlAsk by mutableStateOf(false)
        internal set
    /** Mom said yes: the helper can tap on her phone until the share ends. */
    var controlling by mutableStateOf(false)
        internal set
}

/**
 * Shares Mom's screen with her helper (stage 2). Only ever started by Mom
 * tapping "Show my screen" and accepting Android's own prompt; a notification
 * with Stop shows the whole time. The picture goes phone to phone over WebRTC
 * (end-to-end encrypted); Firestore only carries the setup messages.
 * Apps that block screenshots (banking, passwords) show as black.
 *
 * Tapping for Mom (stage 3) rides on the same connection, in a data channel
 * only the joined helper is on. It works only after the family's safety wait
 * (controlAllowedAt), with Mom's accessibility switch on, and after she taps
 * Yes on her own phone; RemoteControlService does the taps.
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
    private var channel: DataChannel? = null

    private var circleId: String = ""
    private var helperName: String = ""
    private var controlOn = false
    private var asking = false
    private val recent = ArrayDeque<Long>()
    private var captureW = 1
    private var captureH = 1

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
        this.circleId = circleId
        active = this
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
                    helperName = helper
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
        // Never left on by accident: a share ends on its own after an hour.
        main.postDelayed({ stopSharing(endShare = true) }, MAX_SHARE_MS)
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
        val (w, h) = captureSize()
        captureW = w
        captureH = h
        capturer.startCapture(w, h, FPS)

        val config = PeerConnection.RTCConfiguration(
            listOf(
                PeerConnection.IceServer.builder(listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"))
                    .createIceServer(),
            ),
        ).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // Start finding a network path right away, so the helper connects sooner.
            iceCandidatePoolSize = 2
        }
        pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                main.post { sendSignal("candidate", candidateJson(candidate)) }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                // The helper's page closed or the network dropped for good:
                // end it, so nothing is left shared (or tappable) by accident.
                if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED) {
                    main.post { stopSharing(endShare = true) }
                }
            }
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
        pc?.addTrack(track, listOf("screen"))?.let { sender ->
            // Smooth and quick to react: up to 30 pictures a second, and on a
            // slow connection give up a little sharpness before smoothness.
            val params = sender.parameters
            params.degradationPreference = RtpParameters.DegradationPreference.BALANCED
            params.encodings.forEach {
                it.maxFramerate = FPS
                it.maxBitrateBps = MAX_BITRATE
            }
            sender.setParameters(params)
        }
        // Created before the offer so it's part of the same encrypted connection.
        channel = pc?.createDataChannel("control", DataChannel.Init())?.also { dc ->
            dc.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previous: Long) {}
                override fun onStateChange() {
                    if (dc.state() == DataChannel.State.OPEN) main.post { sendControl(if (controlOn) "on" else "ready") }
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (buffer.binary || buffer.data.remaining() > 1000) return
                    val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                    val message = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return
                    main.post { onHelperMessage(message) }
                }
            })
        }
    }

    /**
     * Half the real screen size (status and navigation bars included, the way
     * the capture sees it), so the picture fills the video exactly and the
     * helper's taps land where they aim. Even numbers keep video encoders happy.
     */
    private fun captureSize(): Pair<Int, Int> {
        val (w, h) = realScreenSize(this)
        return (w / 2 and 1.inv()) to (h / 2 and 1.inv())
    }

    /**
     * Where a point on the helper's picture (0..1 of the video) is on Mom's
     * screen (0..1 of the screen), or null on the black bars. The picture's
     * size is fixed when sharing starts (Android 14 doesn't allow resizing it),
     * so when Mom turns her phone sideways her screen shows letterboxed in it.
     */
    private fun toScreen(x: Float, y: Float): Pair<Float, Float>? {
        val (sw, sh) = realScreenSize(this)
        val scale = minOf(captureW.toFloat() / sw, captureH.toFloat() / sh)
        val contentW = sw * scale
        val contentH = sh * scale
        val sx = (x * captureW - (captureW - contentW) / 2) / contentW
        val sy = (y * captureH - (captureH - contentH) / 2) / contentH
        return if (sx in 0f..1f && sy in 0f..1f) sx to sy else null
    }

    // ---------- Tapping for Mom ----------

    private fun onHelperMessage(m: JSONObject) {
        if (stopping || ShareState.watcher.isNullOrBlank()) return
        // A runaway helper page can't flood Mom's phone with taps.
        val now = System.currentTimeMillis()
        while (recent.isNotEmpty() && now - recent.first() > 1000) recent.removeFirst()
        if (recent.size >= MAX_MESSAGES_PER_SECOND) return
        recent.addLast(now)

        when (m.optString("t")) {
            "ask" -> askForControl()
            "tap", "hold", "swipe", "key" -> if (controlOn) doGesture(m)
        }
    }

    private fun askForControl() {
        if (controlOn) return sendControl("on")
        if (asking) return
        asking = true
        // The family's safety wait is checked here, on Mom's own phone.
        db.document("circles/$circleId").get().addOnCompleteListener { task ->
            if (stopping) return@addOnCompleteListener
            @Suppress("UNCHECKED_CAST")
            val circle = if (task.isSuccessful) task.result else null
            val me = (circle?.get("members") as? Map<String, Map<String, Any?>>)?.get(uid)
            val allowedAt = (me?.get("controlAllowedAt") as? Timestamp)?.toDate()?.time
            when {
                allowedAt == null -> { asking = false; sendControl("waiting") }
                allowedAt > System.currentTimeMillis() -> { asking = false; sendControl("waiting", allowedAt) }
                RemoteControlService.instance == null -> {
                    // Mom turns on the switch once; her app shows how.
                    asking = false
                    ShareState.controlAsk = true
                    notify("$helperName wants to tap for you. Open My Tech Kid to allow it.")
                    sendControl("off")
                }
                else -> askMom()
            }
        }
    }

    private fun askMom() {
        val control = RemoteControlService.instance ?: run { asking = false; return sendControl("off") }
        asking = true
        sendControl("asking")
        control.askMom(helperName) { yes ->
            asking = false
            if (stopping) {
                control.hideAll()
            } else if (yes) {
                controlOn = true
                ShareState.controlling = true
                notify("$helperName can see and tap your screen")
                control.showBanner(helperName) { stopSharing(endShare = true) }
                sendControl("on")
            } else {
                sendControl("declined")
            }
        }
    }

    /** Mom turned on the switch after her helper asked: ask her right away. */
    fun onControlSwitchReady() {
        if (stopping || !ShareState.controlAsk) return
        ShareState.controlAsk = false
        askMom()
    }

    /** Mom turned the switch off: tapping stops at once. */
    fun onControlSwitchOff() {
        if (!controlOn && !asking) return
        controlOn = false
        asking = false
        ShareState.controlling = false
        if (!stopping) {
            notify("$helperName can see your screen")
            sendControl("off")
        }
    }

    private fun doGesture(m: JSONObject) {
        val control = RemoteControlService.instance ?: return onControlSwitchOff()
        fun unit(key: String): Float? = m.optDouble(key, Double.NaN).takeIf { it in 0.0..1.0 }?.toFloat()
        fun point(xKey: String, yKey: String): Pair<Float, Float>? {
            val x = unit(xKey) ?: return null
            val y = unit(yKey) ?: return null
            return toScreen(x, y)
        }
        val ok = when (m.optString("t")) {
            "tap", "hold" -> {
                val p = point("x", "y")
                p != null && control.gesture(p.first, p.second, p.first, p.second, if (m.optString("t") == "tap") 60 else 800)
            }
            "swipe" -> {
                // A swipe may end on the black bars; keep its end on the screen.
                val a = point("x1", "y1")
                val x2 = unit("x2"); val y2 = unit("y2")
                val ms = m.optLong("ms", 300).coerceIn(80, 1500)
                if (a == null || x2 == null || y2 == null) {
                    false
                } else {
                    val (sw, sh) = realScreenSize(this)
                    val scale = minOf(captureW.toFloat() / sw, captureH.toFloat() / sh)
                    val bx = ((x2 * captureW - (captureW - sw * scale) / 2) / (sw * scale)).coerceIn(0f, 1f)
                    val by = ((y2 * captureH - (captureH - sh * scale) / 2) / (sh * scale)).coerceIn(0f, 1f)
                    control.gesture(a.first, a.second, bx, by, ms)
                }
            }
            "key" -> control.button(m.optString("name"))
            else -> false
        }
        if (!ok) send(JSONObject().put("t", "refused"))
    }

    private fun sendControl(state: String, until: Long? = null) {
        send(JSONObject().put("t", "control").put("state", state).apply { if (until != null) put("until", until) })
    }

    private fun send(message: JSONObject) {
        val dc = channel ?: return
        if (dc.state() != DataChannel.State.OPEN) return
        dc.send(DataChannel.Buffer(ByteBuffer.wrap(message.toString().toByteArray(Charsets.UTF_8)), false))
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
        if (active === this) active = null
        RemoteControlService.instance?.hideAll()
        controlOn = false
        ShareState.controlAsk = false
        ShareState.controlling = false
        channel?.unregisterObserver()
        channel?.dispose()
        channel = null
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
        private const val MAX_MESSAGES_PER_SECOND = 30
        private const val MAX_SHARE_MS = 60 * 60 * 1000L
        private const val FPS = 30
        private const val MAX_BITRATE = 2_500_000

        /** The share in progress, so RemoteControlService can tell it when Mom's switch changes. */
        var active: ScreenShareService? = null
            private set

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

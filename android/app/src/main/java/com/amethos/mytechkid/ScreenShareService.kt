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
import android.provider.Settings
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
import com.google.firebase.functions.FirebaseFunctions
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
    /** Mom tapped "Agree and show me where" and went to turn the switch on. */
    var setupOpened by mutableStateOf(false)
        internal set
    /** She came back with the switch still off: Android may have said "Restricted setting". */
    var setupBlocked by mutableStateOf(false)
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
    /** The helper has joined: setup messages can go out (the rules refuse them before). */
    private var live = false
    /** Setup messages made before the helper joined, sent the moment they do. */
    private val outbox = mutableListOf<Pair<String, String>>()
    /** A late relay pass needs a fresh network path once the current offer is answered. */
    private var restartPending = false
    /** The network path dropped; looking for a new one (taps wait). */
    private var reconnecting = false
    private var resumedAt = 0L
    private val giveUp = Runnable { if (reconnecting) stopSharing(endShare = true) }
    private val retryPath = Runnable { if (reconnecting) refreshPath() }

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var textures: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var pc: PeerConnection? = null
    private var channel: DataChannel? = null
    private var sender: org.webrtc.RtpSender? = null

    private var circleId: String = ""
    private var helperName: String = ""
    private var controlOn = false
    private var asking = false
    private val recent = ArrayDeque<Long>()
    private var declinedAt = 0L
    private var startedAt = 0L
    /** Which connection is current: "first", then a new id each time the helper's page reloads. */
    private var gen = ""
    private var reconnects = 0
    private var iceServers: List<PeerConnection.IceServer>? = null
    private val serversWaiters = mutableListOf<() -> Unit>()
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
        ).addOnSuccessListener {
            fetchIceServers(circleId, ref.id)
            // Get the connection ready while Mom waits, so her screen shows
            // as soon as her helper joins instead of starting from scratch then.
            withIceServers { if (!stopping && pc == null) connect(FIRST_GEN) }
        }
            .addOnFailureListener { stopSharing(endShare = false) }
        listeners += ref.addSnapshotListener { snap, _ ->
            when (snap?.getString("status")) {
                "live" -> {
                    val helper = firstName(snap.getString("helperName") ?: "Your family")
                    helperName = helper
                    ShareState.watcher = helper
                    ShareState.waiting = false
                    notify("$helper can see your screen")
                    live = true
                    flushOutbox()
                    if (!offered) {
                        offered = true
                        listenForSignals(ref)
                        withIceServers { if (pc == null) connect(FIRST_GEN) }
                    }
                }
                "ended" -> stopSharing(endShare = false)
            }
        }
        // Nobody joined in time: stop on our own (the rules refuse late joins too).
        main.postDelayed({ if (ShareState.waiting) stopSharing(endShare = true) }, JOIN_WINDOW_MS)
        // Never left on by accident: a share ends on its own after an hour of
        // real time (checked often, since timers pause while the phone sleeps).
        startedAt = System.currentTimeMillis()
        main.postDelayed(object : Runnable {
            override fun run() {
                if (tooLong()) stopSharing(endShare = true) else main.postDelayed(this, 30_000)
            }
        }, 30_000)
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
        // Treated as live video, not a slide show: when a lot changes at once
        // (an app opening, a fast scroll), pictures that can't keep up are
        // skipped instead of queued, so the helper's view never stalls behind.
        val source = factory.createVideoSource(false).also { this.source = it }
        capturer.initialize(textures, applicationContext, source.capturerObserver)
        val (w, h) = captureSize()
        captureW = w
        captureH = h
        capturer.startCapture(w, h, FPS)
    }

    /**
     * Opens the encrypted connection to the helper's page and offers Mom's
     * screen. Called again when the helper's page reloads ("hello"), which
     * replaces the old connection; tapping then needs Mom's Yes again.
     */
    private fun connect(newGen: String) {
        val factory = factory ?: return
        val source = source ?: return
        closeConnection()
        gen = newGen
        val myGen = newGen
        val pc = factory.createPeerConnection(rtcConfig(), object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                main.post { if (gen == myGen) sendSignal("candidate", candidateJson(candidate)) }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                main.post { if (gen == myGen) onPathChange(state) }
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
        }) ?: return
        this.pc = pc
        // Start sharp instead of ramping up from a blurry picture, and never
        // drop so low that words can't be read.
        pc.setBitrate(MIN_BITRATE, START_BITRATE, MAX_BITRATE)
        sender = pc.addTrack(factory.createVideoTrack("screen-$myGen", source), listOf("screen"))
        tuneVideo()
        // Created before the offer so it's part of the same encrypted connection.
        channel = pc.createDataChannel("control", DataChannel.Init()).also { dc ->
            dc.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previous: Long) {}
                override fun onStateChange() {
                    val state = dc.state()
                    main.post {
                        if (gen != myGen) return@post
                        when (state) {
                            DataChannel.State.OPEN -> {
                                sendControl("ready")
                                // What this version can do, so the helper's page uses it.
                                send(JSONObject().put("t", "caps").put("ping", true).put("drag", true))
                                sendScreenBars()
                            }
                            // The helper's page went away: stop tapping at once.
                            DataChannel.State.CLOSING, DataChannel.State.CLOSED -> endControl()
                            else -> {}
                        }
                    }
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (buffer.binary || buffer.data.remaining() > 1000) return
                    val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                    val message = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return
                    main.post { if (gen == myGen) onHelperMessage(message) }
                }
            })
        }
        makeOffer(pc, myGen)
    }

    private fun rtcConfig() = PeerConnection.RTCConfiguration(iceServers ?: STUN_ONLY).apply {
        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        // Start finding a network path right away, so the helper connects sooner.
        iceCandidatePoolSize = 2
    }

    /**
     * Up to 30 pictures a second. On a slow connection, trade a little
     * sharpness and a few pictures a second evenly; while the helper taps,
     * keep the pictures a second up and let words soften for a moment, so
     * scrolling and opening apps keep up with their finger (sharp but at
     * 5 pictures a second felt stuck in testing).
     */
    private fun tuneVideo() {
        val sender = sender ?: return
        val params = sender.parameters
        params.degradationPreference = if (controlOn) {
            RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
        } else {
            RtpParameters.DegradationPreference.BALANCED
        }
        params.encodings.forEach {
            it.maxFramerate = FPS
            it.minBitrateBps = MIN_BITRATE
            it.maxBitrateBps = MAX_BITRATE
        }
        sender.setParameters(params)
    }

    /**
     * The network path between the phones. When it drops (Wi-Fi to mobile
     * data, a weak signal), look for a new one on the same connection for up
     * to 30 seconds instead of ending the share; Mom's Stop bar and
     * notification stay up the whole time, and taps wait until it's back.
     */
    private fun onPathChange(state: PeerConnection.IceConnectionState) {
        when (state) {
            PeerConnection.IceConnectionState.DISCONNECTED -> {
                startReconnect()
                // Often comes back by itself within a moment; if not, find a new path.
                main.removeCallbacks(retryPath)
                main.postDelayed(retryPath, RETRY_PATH_MS)
            }
            PeerConnection.IceConnectionState.FAILED -> {
                startReconnect()
                refreshPath()
            }
            PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> endReconnect()
            else -> {}
        }
    }

    private fun startReconnect() {
        if (reconnecting || ShareState.watcher.isNullOrBlank()) return
        reconnecting = true
        RemoteControlService.instance?.endDrag()
        notify("Reconnecting to $helperName…")
        main.removeCallbacks(giveUp)
        main.postDelayed(giveUp, RECONNECT_GRACE_MS)
    }

    private fun endReconnect() {
        if (!reconnecting) return
        reconnecting = false
        resumedAt = System.currentTimeMillis()
        main.removeCallbacks(giveUp)
        main.removeCallbacks(retryPath)
        notify(if (controlOn) "$helperName can see and tap your screen" else "$helperName can see your screen")
    }

    /** Ends the current connection (not the share). Tapping stops with it. */
    private fun closeConnection() {
        endControl()
        reconnecting = false
        main.removeCallbacks(giveUp)
        main.removeCallbacks(retryPath)
        pendingCandidates.clear()
        outbox.clear()
        restartPending = false
        sender = null
        channel?.unregisterObserver()
        channel?.dispose()
        channel = null
        pc?.close()
        pc?.dispose()
        pc = null
    }

    /**
     * Fetched while Mom waits for her helper: network addresses, with a
     * short-lived relay pass for networks that block direct connections (once
     * the family's relay is set up). Plain STUN if the backend is slow or fails.
     */
    private fun fetchIceServers(circleId: String, shareId: String) {
        FirebaseFunctions.getInstance().getHttpsCallable("shareIceServers")
            .call(mapOf("circleId" to circleId, "shareId" to shareId))
            .addOnCompleteListener { task ->
                val list = if (task.isSuccessful) parseIceServers(task.result?.getData()) else null
                main.post { serversReady(list?.takeIf { it.isNotEmpty() } ?: STUN_ONLY, fromBackend = list != null) }
            }
    }

    private fun serversReady(list: List<PeerConnection.IceServer>, fromBackend: Boolean = false) {
        if (stopping) return
        val current = iceServers
        if (current == null) {
            iceServers = list
            serversWaiters.toList().forEach { it() }
            serversWaiters.clear()
            return
        }
        // The relay pass came after we stopped waiting for it: use it now
        // rather than leave a phone on a strict network unable to connect.
        val hasRelay = list.any { s -> s.urls.any { it.startsWith("turn") } }
        if (fromBackend && current === STUN_ONLY && hasRelay) {
            iceServers = list
            val pc = pc ?: return
            if (!live) return connect(gen)
            pc.setConfiguration(rtcConfig())
            refreshPath()
        }
    }

    /** Looks for a new network path on the same connection (an ICE restart); seeing and tapping carry on. */
    private fun refreshPath() {
        val pc = pc ?: return
        if (pc.signalingState() != PeerConnection.SignalingState.STABLE) {
            restartPending = true
            return
        }
        makeOffer(pc, gen, iceRestart = true)
    }

    /** Runs once the addresses are in; the helper is never kept waiting more than a few seconds for them. */
    private fun withIceServers(block: () -> Unit) {
        if (iceServers != null) return block()
        serversWaiters += block
        main.postDelayed({ serversReady(STUN_ONLY) }, ICE_WAIT_MS)
    }

    private fun parseIceServers(data: Any?): List<PeerConnection.IceServer> {
        val list = (data as? Map<*, *>)?.get("iceServers") as? List<*> ?: return emptyList()
        return list.mapNotNull { item ->
            val server = item as? Map<*, *> ?: return@mapNotNull null
            val urls = (server["urls"] as? List<*>)?.filterIsInstance<String>()?.take(10).orEmpty()
            if (urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(urls).apply {
                (server["username"] as? String)?.let { setUsername(it) }
                (server["credential"] as? String)?.let { setPassword(it) }
            }.createIceServer()
        }
    }

    private fun tooLong() = System.currentTimeMillis() - startedAt > MAX_SHARE_MS

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
    private fun toScreen(x: Float, y: Float, screen: Pair<Int, Int>, clamp: Boolean = false): Pair<Float, Float>? {
        val (sw, sh) = screen
        val scale = minOf(captureW.toFloat() / sw, captureH.toFloat() / sh)
        val contentW = sw * scale
        val contentH = sh * scale
        val sx = (x * captureW - (captureW - contentW) / 2) / contentW
        val sy = (y * captureH - (captureH - contentH) / 2) / contentH
        if (clamp) return sx.coerceIn(0f, 1f) to sy.coerceIn(0f, 1f)
        return if (sx in 0f..1f && sy in 0f..1f) sx to sy else null
    }

    // ---------- Tapping for Mom ----------

    private fun onHelperMessage(m: JSONObject) {
        if (stopping || ShareState.watcher.isNullOrBlank()) return
        if (tooLong()) return stopSharing(endShare = true)
        // A runaway helper page can't flood Mom's phone with taps.
        val now = System.currentTimeMillis()
        while (recent.isNotEmpty() && now - recent.first() > 1000) recent.removeFirst()
        if (recent.size >= MAX_MESSAGES_PER_SECOND) return
        recent.addLast(now)

        when (m.optString("t")) {
            "ping" -> send(JSONObject().put("t", "pong"))
            "ask" -> askForControl()
            "tap", "hold", "swipe", "key", "point", "down", "move", "up" -> if (controlOn && !stale()) doGesture(m)
        }
    }

    /**
     * Taps that waited out a dropped connection (or arrive in the moment
     * after it's back) were aimed at a picture that's out of date: drop them.
     */
    private fun stale() = reconnecting || System.currentTimeMillis() - resumedAt < STALE_AFTER_RESUME_MS

    private fun askForControl() {
        if (controlOn) return sendControl("on")
        if (asking) return
        // Mom just said no: don't keep putting the question back on her screen.
        if (System.currentTimeMillis() - declinedAt < ASK_AGAIN_AFTER_MS) {
            return sendControl("declined", declinedAt + ASK_AGAIN_AFTER_MS)
        }
        asking = true
        // The family's safety wait is checked here, on Mom's own phone.
        val askedGen = gen
        db.document("circles/$circleId").get().addOnCompleteListener { task ->
            if (stopping || gen != askedGen || !asking) return@addOnCompleteListener
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
                    sendControl(setupState())
                }
                else -> askMom()
            }
        }
    }

    private fun askMom() {
        val control = RemoteControlService.instance ?: run { asking = false; return sendControl("off") }
        asking = true
        sendControl("asking")
        val askedGen = gen
        control.askMom(helperName) { yes ->
            if (stopping || gen != askedGen || !asking) {
                // The share or connection ended while Mom was being asked.
                control.hideAll()
                return@askMom
            }
            asking = false
            if (yes) {
                controlOn = true
                tuneVideo()
                ShareState.controlling = true
                notify("$helperName can see and tap your screen")
                control.showBanner(helperName) { stopSharing(endShare = true) }
                sendControl("on")
            } else {
                declinedAt = System.currentTimeMillis()
                sendControl("declined", declinedAt + ASK_AGAIN_AFTER_MS)
            }
        }
    }

    /** Mom turned on the switch after her helper asked: ask her right away. */
    fun onControlSwitchReady() {
        if (stopping || !ShareState.controlAsk) return
        clearSetup()
        askMom()
    }

    /** Where Mom is in turning the switch on, so her helper's guide can follow along. */
    private fun setupState() = when {
        ShareState.setupBlocked -> "blocked"
        ShareState.setupOpened -> "opened"
        else -> "off"
    }

    /** Mom tapped "Agree and show me where": she's on her way to the switch. */
    fun onSwitchOpened() {
        if (stopping || !ShareState.controlAsk) return
        ShareState.setupOpened = true
        sendControl(setupState())
    }

    /**
     * Mom came back to My Tech Kid and the switch is still off. On Android 13
     * and later that's usually the "Restricted setting" block apps from a link
     * get, so her screen shows how to lift it.
     */
    fun onBackFromSwitch() {
        if (stopping || !ShareState.controlAsk || !ShareState.setupOpened) return
        if (RemoteControlService.instance != null || Build.VERSION.SDK_INT < 33) return
        ShareState.setupBlocked = true
        sendControl(setupState())
    }

    /** Mom tapped "Not now": same as saying no to her helper. */
    fun onSetupNotNow() {
        if (stopping || !ShareState.controlAsk) return
        clearSetup()
        declinedAt = System.currentTimeMillis()
        sendControl("declined", declinedAt + ASK_AGAIN_AFTER_MS)
    }

    private fun clearSetup() {
        ShareState.controlAsk = false
        ShareState.setupOpened = false
        ShareState.setupBlocked = false
    }

    /** Mom turned the switch off: tapping stops at once. */
    fun onControlSwitchOff() {
        if (!controlOn && !asking) return
        endControl()
        sendControl("off")
    }

    /** Tapping stops (the question and Stop bar go away); seeing carries on. */
    private fun endControl() {
        if (!controlOn && !asking) return
        controlOn = false
        asking = false
        tuneVideo()
        ShareState.controlling = false
        RemoteControlService.instance?.hideAll()
        if (!stopping) notify("$helperName can see your screen")
    }

    private fun doGesture(m: JSONObject) {
        val control = RemoteControlService.instance ?: return onControlSwitchOff()
        val screen = realScreenSize(this)
        fun unit(key: String): Float? = m.optDouble(key, Double.NaN).takeIf { it in 0.0..1.0 }?.toFloat()
        fun point(xKey: String, yKey: String, clamp: Boolean = false): Pair<Float, Float>? {
            val x = unit(xKey) ?: return null
            val y = unit(yKey) ?: return null
            return toScreen(x, y, screen, clamp)
        }
        val ok = when (m.optString("t")) {
            "tap", "hold" -> {
                val p = point("x", "y")
                p != null && control.gesture(p.first, p.second, p.first, p.second, if (m.optString("t") == "tap") 60 else 800, screen)
            }
            "swipe" -> {
                // A swipe may end on the black bars; keep its end on the screen.
                val a = point("x1", "y1")
                val b = point("x2", "y2", clamp = true)
                val ms = m.optLong("ms", 300).coerceIn(80, 1500)
                a != null && b != null && control.gesture(a.first, a.second, b.first, b.second, ms, screen)
            }
            // A live drag: the helper's finger going down, moving and lifting.
            "down", "move", "up" -> point("x", "y", clamp = true)?.let { control.drag(m.optString("t"), it.first, it.second, screen) } ?: false
            "key" -> control.button(m.optString("name"))
            // "Look here": a ring on her screen, nothing is tapped.
            "point" -> point("x", "y")?.let { control.point(it.first, it.second, screen) } ?: false
            else -> false
        }
        // A drag that reaches her Stop bar just ends there; only say so when it starts on it.
        if (!ok && m.optString("t") != "move" && m.optString("t") != "up") send(JSONObject().put("t", "refused"))
    }

    /**
     * How tall her top bar (clock, Wi-Fi) and Android's own buttons are, as
     * parts of the screen's height, so her helper's page can cut them off and
     * show only our button bar. Gesture navigation has no buttons to cut, and
     * sideways there's nothing to cut either.
     */
    private fun sendScreenBars() {
        val (w, h) = realScreenSize(this)
        fun dimen(name: String): Int {
            val id = resources.getIdentifier(name, "dimen", "android")
            return if (id > 0) resources.getDimensionPixelSize(id) else 0
        }
        val gestures = runCatching { Settings.Secure.getInt(contentResolver, "navigation_mode") == 2 }.getOrDefault(false)
        val top = if (w < h) dimen("status_bar_height") else 0
        val bottom = if (w < h && !gestures) dimen("navigation_bar_height") else 0
        send(JSONObject().put("t", "screen").put("top", top.toDouble() / h).put("bottom", bottom.toDouble() / h))
    }

    private fun sendControl(state: String, until: Long? = null) {
        send(JSONObject().put("t", "control").put("state", state).apply { if (until != null) put("until", until) })
    }

    private fun send(message: JSONObject) {
        val dc = channel ?: return
        if (dc.state() != DataChannel.State.OPEN) return
        dc.send(DataChannel.Buffer(ByteBuffer.wrap(message.toString().toByteArray(Charsets.UTF_8)), false))
    }

    private fun makeOffer(pc: PeerConnection, myGen: String, iceRestart: Boolean = false) {
        pc.createOffer(object : SdpAdapter() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(object : SdpAdapter() {
                    override fun onSetSuccess() {
                        main.post {
                            if (gen == myGen) {
                                sendSignal("offer", JSONObject().put("sdp", desc.description).put("gen", myGen).toString())
                            }
                        }
                    }
                }, desc)
            }
        }, MediaConstraints().apply {
            if (iceRestart) mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        })
    }

    private fun listenForSignals(ref: DocumentReference) {
        listeners += ref.collection("signals").orderBy("createdAt").addSnapshotListener { snap, _ ->
            snap?.documents.orEmpty().forEach { d ->
                if (d.id in seen || d.getString("from") == uid) return@forEach
                seen += d.id
                val payload = runCatching { JSONObject(d.getString("payload") ?: "") }.getOrNull() ?: return@forEach
                val type = d.getString("type")
                // The helper's page reloaded: start a fresh connection for it.
                if (type == "hello") {
                    val newGen = payload.optString("gen").take(40)
                    // (A runaway page can't keep Mom's phone reconnecting forever.)
                    if (newGen.isNotBlank() && newGen != gen && reconnects++ < MAX_RECONNECTS) connect(newGen)
                    return@forEach
                }
                // Messages for an older connection (before a reload) are ignored.
                // Pages from before reconnecting existed send no gen at all.
                if (payload.optString("gen", FIRST_GEN) != gen) return@forEach
                when (type) {
                    "answer" -> pc?.setRemoteDescription(object : SdpAdapter() {
                        override fun onSetSuccess() {
                            main.post {
                                pendingCandidates.forEach { pc?.addIceCandidate(it) }
                                pendingCandidates.clear()
                                if (restartPending) {
                                    restartPending = false
                                    refreshPath()
                                }
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
        if (!live) {
            outbox += type to payload
            return
        }
        ref.collection("signals").add(
            mapOf("from" to uid, "type" to type, "payload" to payload, "createdAt" to FieldValue.serverTimestamp()),
        )
    }

    private fun flushOutbox() {
        val waiting = outbox.toList()
        outbox.clear()
        waiting.forEach { (type, payload) -> sendSignal(type, payload) }
    }

    private fun candidateJson(c: IceCandidate) = JSONObject()
        .put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).put("gen", gen).toString()

    private fun stopSharing(endShare: Boolean) {
        if (stopping) return
        stopping = true
        main.removeCallbacksAndMessages(null)
        listeners.forEach { it.remove() }
        listeners.clear()
        if (active === this) active = null
        closeConnection()
        RemoteControlService.instance?.hideAll()
        clearSetup()
        ShareState.controlling = false
        if (endShare) {
            shareRef?.update(mapOf("status" to "ended", "endedBy" to uid, "endedAt" to FieldValue.serverTimestamp()))
        }
        runCatching { capturer?.stopCapture() }
        capturer?.dispose()
        source?.dispose()
        textures?.dispose()
        factory?.dispose()
        egl?.release()
        capturer = null; source = null; textures = null; factory = null; egl = null
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
        private const val ASK_AGAIN_AFTER_MS = 15_000L
        private const val FIRST_GEN = "first"
        private const val MAX_RECONNECTS = 20
        private const val ICE_WAIT_MS = 4_000L
        private const val RECONNECT_GRACE_MS = 30_000L
        private const val RETRY_PATH_MS = 2_000L
        private const val STALE_AFTER_RESUME_MS = 1_000L
        private val STUN_ONLY = listOf(
            PeerConnection.IceServer.builder(listOf("stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"))
                .createIceServer(),
        )
        private const val FPS = 30
        private const val MAX_BITRATE = 2_500_000
        private const val START_BITRATE = 1_000_000
        private const val MIN_BITRATE = 150_000

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

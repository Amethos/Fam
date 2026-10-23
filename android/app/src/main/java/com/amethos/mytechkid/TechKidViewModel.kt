package com.amethos.mytechkid

import android.app.Application
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

private const val MAX_TALK_SECONDS = 60.0
private const val MAX_VOICE_BYTES = 400_000

/** "Josh Smith" -> "Josh": Mom's screens use first names only. */
fun firstName(name: String): String = name.trim().split(Regex("\\s+")).first().ifBlank { name }

data class InviteLink(val circleId: String, val inviteId: String, val token: String)
data class Picture(val emoji: String, val label: String)
data class HelpRequest(
    val id: String,
    val status: String,
    val helperName: String?,
    val practice: Boolean = false,
    val hasVoice: Boolean = false,
)

/** The "Tell Josh what's wrong" screen, after Mom taps Tap for help. */
sealed interface Talk {
    data object Ready : Talk
    data class Recording(val seconds: Int) : Talk
    data object Sending : Talk
}
data class ScamCheck(
    val id: String,
    val text: String,
    val verdict: String?,
    val note: String?,
    val answeredByName: String?,
    val createdAt: Long,
)

sealed interface Screen {
    data object Loading : Screen
    data object NotConfigured : Screen
    data class Welcome(val message: String? = null) : Screen
    data class InviteAsk(val invite: InviteLink, val helperName: String) : Screen
    data class Pictures(
        val invite: InviteLink,
        val helperName: String,
        val pictures: List<Picture>,
        val confirmed: Boolean,
    ) : Screen
    data object Intro : Screen
    data object Home : Screen
    data object Talk : Screen
    data class Scam(val draft: String) : Screen
}

/** Everything Mom's phone knows and can do. The UI in ui/Screens.kt only reads and calls this. */
class TechKidViewModel(app: Application) : AndroidViewModel(app) {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val functions = FirebaseFunctions.getInstance()
    private val prefs = app.getSharedPreferences("mytechkid", android.content.Context.MODE_PRIVATE)

    var screen by mutableStateOf<Screen>(Screen.Loading)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    var myName by mutableStateOf("")
        private set
    var helperNames by mutableStateOf(listOf<String>())
        private set
    var activeHelp by mutableStateOf<HelpRequest?>(null)
        private set
    /** The one-time practice run on the intro screen. */
    var practiceHelp by mutableStateOf<HelpRequest?>(null)
        private set

    var talk by mutableStateOf<Talk>(Talk.Ready)
        private set
    /** Her own words from her last voice message, shown back to her ("You said …"). */
    var lastSaid by mutableStateOf<Pair<String, String>?>(null) // help request id to words
        private set
    private val recorder = VoiceRecorder(app)
    private var talkJob: kotlinx.coroutines.Job? = null

    /** Counts each time the app comes back on screen (MainActivity.onResume). */
    var resumes by mutableStateOf(0)

    // Help requests whose "show your screen" question already came up once.
    private val shareAsked = mutableSetOf<String>()

    /** True the first time only: their helper said "I'm on it", so offer to share right away. */
    fun firstShareAsk(helpId: String): Boolean = shareAsked.add(helpId)
    var scamChecks by mutableStateOf(listOf<ScamCheck>())
        private set
    var updateReady by mutableStateOf(false)
        private set
    var updating by mutableStateOf(false)
        private set
    private var lastUpdateCheck = 0L

    private var uid: String? = null
    private var circleId: String? = null
    private var userLoaded = false
    private var pendingInvite: InviteLink? = null
    private var pendingScamText: String? = null
    private var userListener: ListenerRegistration? = null
    private var inviteListener: ListenerRegistration? = null
    private val circleListeners = mutableListOf<ListenerRegistration>()

    init {
        if (TechKidApp.isPlaceholderConfig(app)) {
            screen = Screen.NotConfigured
        } else {
            viewModelScope.launch { start() }
        }
    }

    private suspend fun start() {
        try {
            // Mom never makes an account: this phone is her identity.
            val user = auth.currentUser ?: auth.signInAnonymously().await().user!!
            uid = user.uid
            listenToUser(user.uid)
            reportDevice()
            registerPushToken()
        } catch (e: Exception) {
            screen = Screen.Welcome(friendly(e))
        }
    }

    /** Tells the family what kind of phone this is, so the helper's app picks the right way to help. */
    private suspend fun reportDevice() {
        val me = uid ?: return
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = if (Build.MODEL.startsWith(maker, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
        val device = buildMap<String, Any> {
            put("platform", "android")
            put("model", model.take(60))
            Build.VERSION.RELEASE.substringBefore('.').toIntOrNull()?.takeIf { it in 1..99 }?.let { put("osVersion", it) }
        }
        try {
            db.document("users/$me").set(mapOf("device" to device), SetOptions.merge()).await()
        } catch (e: Exception) {
            // Only used to pick how to help; the app works without it.
        }
    }

    suspend fun registerPushToken() {
        val me = uid ?: return
        try {
            val token = FirebaseMessaging.getInstance().token.await()
            db.document("users/$me").set(
                mapOf("fcmTokens" to FieldValue.arrayUnion(token), "platform" to "android"),
                SetOptions.merge(),
            ).await()
        } catch (e: Exception) {
            // Alerts are a bonus; the app still works without them.
        }
    }

    private fun listenToUser(me: String) {
        userListener?.remove()
        userListener = db.document("users/$me").addSnapshotListener { snap, _ ->
            userLoaded = true
            myName = snap?.getString("displayName") ?: ""
            val newCircle = snap?.getString("circleId")
            if (newCircle != circleId) {
                circleId = newCircle
                watchCircle(newCircle)
            }
            when {
                newCircle != null && screen !is Screen.Home && screen !is Screen.Talk && screen !is Screen.Scam && screen !is Screen.Intro -> {
                    inviteListener?.remove()
                    val shared = pendingScamText
                    pendingScamText = null
                    screen = when {
                        shared != null -> Screen.Scam(shared)
                        !introSeen() -> Screen.Intro
                        else -> Screen.Home
                    }
                    if (pendingInvite != null) {
                        pendingInvite = null
                        error = "This phone is already linked to your family."
                    }
                }
                // A helper removed this phone from the family (lost or replaced).
                newCircle == null && (screen is Screen.Home || screen is Screen.Talk || screen is Screen.Scam || screen is Screen.Intro) -> {
                    stopTalk()
                    activeHelp = null
                    practiceHelp = null
                    scamChecks = emptyList()
                    helperNames = emptyList()
                    screen = Screen.Welcome("This phone isn't connected to your family any more.")
                }
                newCircle == null && screen is Screen.Loading -> {
                    val invite = pendingInvite
                    pendingInvite = null
                    if (invite != null) openInvite(invite) else screen = Screen.Welcome()
                }
            }
        }
    }

    private fun watchCircle(id: String?) {
        circleListeners.forEach { it.remove() }
        circleListeners.clear()
        val me = uid
        if (id == null || me == null) return
        circleListeners += db.document("circles/$id").addSnapshotListener { snap, _ ->
            @Suppress("UNCHECKED_CAST")
            val members = snap?.get("members") as? Map<String, Map<String, Any?>> ?: emptyMap()
            @Suppress("UNCHECKED_CAST")
            val helperIds = snap?.get("helperIds") as? List<String> ?: emptyList()
            helperNames = helperIds.mapNotNull { (members[it]?.get("name") as? String)?.let(::firstName) }
        }
        circleListeners += db.collection("circles/$id/helpRequests")
            .whereEqualTo("parentId", me)
            // Only open requests: finished ones would pile up and be re-read every launch.
            .whereIn("status", listOf("waiting", "accepted"))
            .addSnapshotListener { snap, _ ->
                val open = snap?.documents.orEmpty()
                    .sortedByDescending { it.getTimestamp("createdAt")?.toDate()?.time ?: Long.MAX_VALUE }
                    .map {
                        HelpRequest(
                            it.id, it.getString("status")!!, it.getString("helperName")?.let(::firstName),
                            practice = it.getBoolean("practice") == true,
                            hasVoice = it.getBoolean("hasVoice") == true,
                        )
                    }
                activeHelp = open.firstOrNull { !it.practice }
                practiceHelp = open.firstOrNull { it.practice }
            }
        circleListeners += db.collection("circles/$id/scamChecks")
            .whereEqualTo("parentId", me)
            // Mom's screen shows only her latest check; don't load her whole history.
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(5)
            .addSnapshotListener { snap, _ ->
                scamChecks = snap?.documents.orEmpty().map {
                    ScamCheck(
                        id = it.id,
                        text = it.getString("text") ?: "",
                        verdict = it.getString("verdict"),
                        note = it.getString("note"),
                        answeredByName = it.getString("answeredByName"),
                        createdAt = it.getTimestamp("createdAt")?.toDate()?.time ?: System.currentTimeMillis(),
                    )
                }.sortedByDescending { it.createdAt }
            }
    }

    // ---------- Intents from outside the app ----------

    fun handleInviteLink(invite: InviteLink) {
        when {
            circleId != null -> error = "This phone is already linked to your family."
            !userLoaded -> pendingInvite = invite
            else -> openInvite(invite)
        }
    }

    fun handleSharedText(text: String) {
        when {
            circleId != null -> screen = Screen.Scam(text)
            !userLoaded -> pendingScamText = text
            else -> error = "My Tech Kid isn't set up yet. Ask your family to send you an invite link."
        }
    }

    // ---------- Pairing ----------

    private fun openInvite(invite: InviteLink) = act {
        screen = Screen.Loading
        try {
            val result = call("peekInvite", invite.asMap())
            screen = Screen.InviteAsk(invite, (result["helperName"] as? String)?.let(::firstName) ?: "Your family")
        } catch (e: Exception) {
            screen = Screen.Welcome(friendly(e))
        }
    }

    fun acceptInvite() = act {
        val ask = screen as? Screen.InviteAsk ?: return@act
        val result = call("claimInvite", ask.invite.asMap())
        @Suppress("UNCHECKED_CAST")
        val pictures = (result["pictures"] as? List<Map<String, Any?>>).orEmpty().map {
            Picture(it["emoji"] as? String ?: "", it["label"] as? String ?: "")
        }
        screen = Screen.Pictures(ask.invite, ask.helperName, pictures, confirmed = false)
        watchInvite(ask.invite)
    }

    fun rejectInvite() {
        screen = Screen.Welcome("Good call. You can delete that message. Only use invites from family you know.")
    }

    fun confirmPictures(match: Boolean) = act {
        val current = screen as? Screen.Pictures ?: return@act
        val result = call(
            "confirmInvite",
            mapOf("circleId" to current.invite.circleId, "inviteId" to current.invite.inviteId, "match" to match),
        )
        when (result["status"]) {
            "cancelled" -> screen = Screen.Welcome(
                "Stopped. Nothing was linked. If this wasn't your family, delete the message.",
            )
            "expired" -> screen = Screen.Welcome("This invite expired. Ask your family to send a new one.")
            "waiting" -> screen = current.copy(confirmed = true)
            // "linked": the user listener moves us to Home.
        }
    }

    private fun watchInvite(invite: InviteLink) {
        inviteListener?.remove()
        inviteListener = db.document("circles/${invite.circleId}/invites/${invite.inviteId}")
            .addSnapshotListener { snap, _ ->
                if (screen !is Screen.Pictures) return@addSnapshotListener
                when (snap?.getString("status")) {
                    "cancelled" -> screen = Screen.Welcome("Your family stopped this invite. Ask them to send a new one.")
                    "expired" -> screen = Screen.Welcome("This invite expired. Ask your family to send a new one.")
                }
            }
    }

    // ---------- Help and scam checks ----------

    private fun myCircleName(): String = myName.ifBlank { "Your family member" }

    /**
     * Tap for help, talk first: Mom can say what's wrong before anything is sent,
     * so her helper's one alert already says there's a voice message. If she
     * taps nothing for 30 seconds, the request goes anyway: she's never stuck.
     */
    fun askForHelp() {
        if (circleId == null || busy) return
        talk = Talk.Ready
        screen = Screen.Talk
        talkJob?.cancel()
        talkJob = viewModelScope.launch {
            kotlinx.coroutines.delay(30_000)
            if (screen == Screen.Talk && talk == Talk.Ready) sendHelp(null)
        }
    }

    /** "Just ask Josh to call me", or the microphone isn't allowed: send without a message. */
    fun askWithoutTalking() {
        if (talk == Talk.Ready) sendHelp(null)
    }

    /** Back from the talk screen: she changed her mind, nothing was sent. */
    fun leaveTalk() {
        if (talk is Talk.Sending) return
        stopTalk()
        screen = Screen.Home
    }

    private fun stopTalk() {
        talkJob?.cancel()
        recorder.cancel()
        talk = Talk.Ready
    }

    /** Mom tapped the microphone (and the phone allows it): record until she stops talking. */
    fun startTalking() {
        if (talk != Talk.Ready) return
        talkJob?.cancel()
        try {
            recorder.start()
        } catch (e: Exception) {
            sendHelp(null) // the microphone didn't work; still get her help
            return
        }
        talk = Talk.Recording(0)
        talkJob = viewModelScope.launch {
            var spoke = false
            var quietMs = 0
            while (true) {
                kotlinx.coroutines.delay(200)
                val level = recorder.level()
                if (level > 2_000) {
                    spoke = true
                    quietMs = 0
                } else if (spoke) {
                    quietMs += 200
                }
                val seconds = recorder.seconds()
                talk = Talk.Recording(seconds.toInt())
                // Done after 4 seconds of quiet, or at one minute.
                if ((spoke && quietMs >= 4_000) || seconds >= MAX_TALK_SECONDS) break
            }
            finishTalking()
        }
    }

    /** "Send to Josh", or she stopped talking. */
    fun finishTalking() {
        if (talk !is Talk.Recording) return
        talkJob?.cancel()
        val recording = recorder.stop()
        sendHelp(recording?.takeIf { it.bytes.size in 1..MAX_VOICE_BYTES && it.seconds >= 1.0 })
    }

    private fun sendHelp(voice: Recording?) {
        val id = circleId ?: return
        talk = Talk.Sending
        act {
            try {
                val help = db.collection("circles/$id/helpRequests").document()
                val batch = db.batch()
                batch.set(
                    help,
                    mapOf(
                        "parentId" to uid,
                        "parentName" to myCircleName(),
                        "status" to "waiting",
                        "createdAt" to FieldValue.serverTimestamp(),
                        "hasVoice" to (voice != null),
                    ),
                )
                if (voice != null) {
                    batch.set(
                        help.collection("voice").document("clip"),
                        mapOf(
                            "audio" to com.google.firebase.firestore.Blob.fromBytes(voice.bytes),
                            "mime" to "audio/mp4",
                            "seconds" to voice.seconds.coerceIn(1.0, MAX_TALK_SECONDS),
                            "createdAt" to FieldValue.serverTimestamp(),
                        ),
                    )
                }
                batch.commit().await()
                screen = Screen.Home
                if (voice != null) addWords(help, voice)
            } finally {
                talk = Talk.Ready
            }
        }
    }

    /** Her words follow a moment later; the alert never carries them. */
    private fun addWords(help: com.google.firebase.firestore.DocumentReference, voice: Recording) {
        viewModelScope.launch {
            val words = try { VoiceWords.transcribe(getApplication<Application>(), voice.file) } catch (e: Exception) { null }
            voice.file.delete()
            if (words == null) return@launch
            lastSaid = help.id to words
            try {
                help.collection("voice").document("clip").update("said", words).await()
            } catch (e: Exception) {
                // Her helper can still play the recording.
            }
        }
    }

    /** Intro: Mom tries her button once, and her helper answers "Got it". */
    fun tryPractice() = act {
        val id = circleId ?: return@act
        if (practiceHelp != null) return@act
        db.collection("circles/$id/helpRequests").add(
            mapOf(
                "parentId" to uid,
                "parentName" to myCircleName(),
                "status" to "waiting",
                "createdAt" to FieldValue.serverTimestamp(),
                "practice" to true,
            ),
        ).await()
    }

    fun finishHelp(status: String) = act {
        val id = circleId ?: return@act
        val help = activeHelp ?: return@act
        db.document("circles/$id/helpRequests/${help.id}").update(
            mapOf("status" to status, "updatedAt" to FieldValue.serverTimestamp()),
        ).await()
    }

    /** Mom said yes to Android's sharing prompt: start showing her helper the screen. */
    fun startScreenShare(context: android.content.Context, projection: android.content.Intent) {
        val id = circleId ?: return
        val me = uid ?: return
        ScreenShareService.start(context, projection, id, me, myCircleName())
    }

    fun openScamCheck() {
        screen = Screen.Scam("")
    }

    fun sendScamCheck(text: String) = act {
        val id = circleId ?: return@act
        val trimmed = text.trim().take(2000)
        if (trimmed.isEmpty()) {
            error = "Paste or type the message first."
            return@act
        }
        db.collection("circles/$id/scamChecks").add(
            mapOf(
                "parentId" to uid,
                "parentName" to myCircleName(),
                "text" to trimmed,
                "createdAt" to FieldValue.serverTimestamp(),
                "verdict" to null,
            ),
        ).await()
        screen = Screen.Scam("")
    }

    // ---------- First-time intro (after linking) ----------

    // ---------- Beta updates ----------

    /** Called whenever the app comes to the front; checks at most every 15 minutes. */
    fun checkForUpdate() {
        val now = System.currentTimeMillis()
        if (updating || now - lastUpdateCheck < 15 * 60_000) return
        lastUpdateCheck = now
        viewModelScope.launch {
            updateReady = try { Updater.isUpdateAvailable(getApplication<Application>()) } catch (e: Exception) { false }
        }
    }

    fun startUpdate() {
        if (updating) return
        updating = true
        error = null
        viewModelScope.launch {
            try {
                Updater.downloadAndInstall(getApplication<Application>())
            } catch (e: Exception) {
                error = "Couldn't get the update right now. Try again later."
            } finally {
                updating = false
                lastUpdateCheck = 0L
            }
        }
    }

    fun introSeen(): Boolean = prefs.getBoolean("introSeen", false)

    fun finishIntro() {
        prefs.edit().putBoolean("introSeen", true).apply()
        screen = Screen.Home
        // Close the practice run so it never shows up as real help.
        val id = circleId ?: return
        val practice = practiceHelp ?: return
        db.document("circles/$id/helpRequests/${practice.id}").update(
            mapOf("status" to if (practice.status == "accepted") "done" else "cancelled", "updatedAt" to FieldValue.serverTimestamp()),
        )
    }

    fun goHome() {
        screen = if (circleId != null) Screen.Home else Screen.Welcome()
    }

    // ---------- Plumbing ----------

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            busy = true
            error = null
            try {
                block()
            } catch (e: Exception) {
                error = friendly(e)
            } finally {
                busy = false
            }
        }
    }

    private suspend fun call(name: String, data: Map<String, Any?>): Map<*, *> =
        functions.getHttpsCallable(name).call(data).await().getData() as? Map<*, *> ?: emptyMap<String, Any?>()

    private fun InviteLink.asMap() = mapOf("circleId" to circleId, "inviteId" to inviteId, "token" to token)

    private fun friendly(e: Exception): String = when (e) {
        is FirebaseFunctionsException -> e.message ?: "Something went wrong. Try again."
        else -> "Couldn't reach your family. Check your internet and try again."
    }

    override fun onCleared() {
        recorder.cancel()
        userListener?.remove()
        inviteListener?.remove()
        circleListeners.forEach { it.remove() }
    }
}

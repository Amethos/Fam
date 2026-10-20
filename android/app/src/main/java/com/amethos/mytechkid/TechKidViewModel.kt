package com.amethos.mytechkid

import android.app.Application
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
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import com.amethos.mytechkid.ask.Pictures
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.tasks.await

/** "Josh Smith" -> "Josh": Mom's screens use first names only. */
fun firstName(name: String): String = name.trim().split(Regex("\\s+")).first().ifBlank { name }

data class InviteLink(val circleId: String, val inviteId: String, val token: String)
data class Picture(val emoji: String, val label: String)
data class HelpRequest(val id: String, val status: String, val helperName: String?, val practice: Boolean = false)
data class ScamCheck(
    val id: String,
    val text: String,
    val hasPicture: Boolean,
    val verdict: String?,
    val note: String?,
    val answeredByName: String?,
    val createdAt: Long,
)

/** What the helper switched on for this phone. Mom's app only reads it. */
data class PhoneSettings(val askTab: Boolean = false, val updatedAt: Long = 0)

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
    data class Scam(val draft: String) : Screen
    /** "Send this to Josh?" with a picture of the screen. covered: passwords and codes were covered up. */
    data class SendPicture(val file: String, val covered: Boolean) : Screen
    /** Explains the ask button before Android's settings page (needs an Agree tap). */
    data object AskSetup : Screen
}

/** Screens that belong to a linked phone. */
private val Screen.linked: Boolean
    get() = this is Screen.Home || this is Screen.Scam || this is Screen.Intro ||
        this is Screen.SendPicture || this is Screen.AskSetup

/** Everything Mom's phone knows and can do. The UI in ui/Screens.kt only reads and calls this. */
class TechKidViewModel(app: Application) : AndroidViewModel(app) {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val functions = FirebaseFunctions.getInstance()
    private val storage = FirebaseStorage.getInstance()
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
    var scamChecks by mutableStateOf(listOf<ScamCheck>())
        private set
    var phoneSettings by mutableStateOf(PhoneSettings())
        private set
    /** Whether the ask button is turned on in Android's settings; refreshed when the app comes to the front. */
    var askButtonOn by mutableStateOf(false)
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
    private var pendingPicture: Screen.SendPicture? = null
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
            registerPushToken()
        } catch (e: Exception) {
            screen = Screen.Welcome(friendly(e))
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
                newCircle != null && !screen.linked -> {
                    inviteListener?.remove()
                    val shared = pendingScamText
                    val picture = pendingPicture
                    pendingScamText = null
                    pendingPicture = null
                    screen = when {
                        picture != null -> picture
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
                newCircle == null && screen.linked -> {
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
                    .map { HelpRequest(it.id, it.getString("status")!!, it.getString("helperName")?.let(::firstName), it.getBoolean("practice") == true) }
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
                        hasPicture = it.getString("imagePath") != null,
                        verdict = it.getString("verdict"),
                        note = it.getString("note"),
                        answeredByName = it.getString("answeredByName"),
                        createdAt = it.getTimestamp("createdAt")?.toDate()?.time ?: System.currentTimeMillis(),
                    )
                }.sortedByDescending { it.createdAt }
            }
        circleListeners += db.document("circles/$id/phoneSettings/$me").addSnapshotListener { snap, _ ->
            phoneSettings = PhoneSettings(
                askTab = snap?.getBoolean("askTab") == true,
                updatedAt = snap?.getTimestamp("updatedAt")?.toDate()?.time ?: 0,
            )
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

    /** A screenshot shared to My Tech Kid, or picked in the photo picker. */
    fun handleSharedImage(uri: Uri) = act {
        val file = withContext(Dispatchers.IO) { Pictures.fromUri(getApplication<Application>(), uri) }
        if (file == null) {
            error = "Couldn't open that picture. Try another one."
            return@act
        }
        when {
            circleId != null -> screen = Screen.SendPicture(file.name, covered = false)
            !userLoaded -> pendingPicture = Screen.SendPicture(file.name, covered = false)
            else -> error = "My Tech Kid isn't set up yet. Ask your family to send you an invite link."
        }
    }

    /** A picture from the ask button at the edge of the screen. */
    fun handleAskPicture(name: String, covered: Boolean) {
        if (Pictures.file(getApplication<Application>(), name) == null) return
        when {
            circleId != null -> screen = Screen.SendPicture(name, covered)
            !userLoaded -> pendingPicture = Screen.SendPicture(name, covered)
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

    fun askForHelp() = act {
        val id = circleId ?: return@act
        db.collection("circles/$id/helpRequests").add(
            mapOf(
                "parentId" to uid,
                "parentName" to myCircleName(),
                "status" to "waiting",
                "createdAt" to FieldValue.serverTimestamp(),
            ),
        ).await()
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

    /** Mom tapped Send: the picture goes to the family's folder, then the scam check that points at it. */
    fun sendPicture() = act {
        val id = circleId ?: return@act
        val me = uid ?: return@act
        val current = screen as? Screen.SendPicture ?: return@act
        val file = Pictures.file(getApplication<Application>(), current.file)
        if (file == null) {
            screen = Screen.Scam("")
            return@act
        }
        val check = db.collection("circles/$id/scamChecks").document()
        val path = "circles/$id/scamShots/$me/${check.id}.jpg"
        storage.reference.child(path).putFile(
            Uri.fromFile(file),
            StorageMetadata.Builder().setContentType("image/jpeg").build(),
        ).await()
        check.set(
            mapOf(
                "parentId" to me,
                "parentName" to myCircleName(),
                "text" to "",
                "imagePath" to path,
                "createdAt" to FieldValue.serverTimestamp(),
                "verdict" to null,
            ),
        ).await()
        file.delete()
        screen = Screen.Scam("")
    }

    fun discardPicture() {
        (screen as? Screen.SendPicture)?.let { Pictures.file(getApplication<Application>(), it.file)?.delete() }
        goHome()
    }

    // ---------- The ask button (helper turns it on; Mom agrees once) ----------

    fun refreshAskButton() {
        askButtonOn = Pictures.isAskButtonOn(getApplication<Application>())
    }

    private var askSetupDismissedAt by mutableStateOf(prefs.getLong("askSetupDismissed", 0))

    /** The helper turned the button on, and Mom hasn't set it up or said "Not now" to this request. */
    val askSetupWanted: Boolean
        get() = Pictures.supported && phoneSettings.askTab && !askButtonOn &&
            askSetupDismissedAt < phoneSettings.updatedAt

    fun openAskSetup() {
        screen = Screen.AskSetup
    }

    fun dismissAskSetup() {
        askSetupDismissedAt = phoneSettings.updatedAt
        prefs.edit().putLong("askSetupDismissed", askSetupDismissedAt).apply()
        goHome()
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
        userListener?.remove()
        inviteListener?.remove()
        circleListeners.forEach { it.remove() }
    }
}

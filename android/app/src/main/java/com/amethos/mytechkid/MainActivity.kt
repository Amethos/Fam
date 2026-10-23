package com.amethos.mytechkid

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import com.amethos.mytechkid.ui.TechKidScreens
import com.amethos.mytechkid.ui.TechKidTheme

class MainActivity : ComponentActivity() {
    private val vm: TechKidViewModel by viewModels()

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Android's own "Start sharing?" prompt. Mom must say yes every time.
    private val askToShareScreen =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            askedAt = 0L
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) vm.startScreenShare(this, data)
        }
    // When Android's prompt was last asked for (0 once it answered).
    private var askedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        // First time, the intro screen explains notifications before Android asks.
        if (vm.introSeen()) askForNotificationsIfNeeded()
        setContent {
            TechKidTheme {
                // The welcome screen shows once the app knows this phone isn't
                // linked yet: look for an invite copied by the invite page.
                val welcome = vm.screen is Screen.Welcome
                LaunchedEffect(welcome) { if (welcome) pickUpCopiedInvite() }
                TechKidScreens(
                    vm,
                    onIntroDone = {
                        askForNotificationsIfNeeded()
                        vm.finishIntro()
                    },
                    onShowScreen = { showScreenPrompt() },
                    onStopScreen = { ScreenShareService.stop(this) },
                    onTextHelper = ::textSomeoneWhoCanHelp,
                )
            }
        }
    }

    /**
     * Android's "Share your screen?" prompt. Gray saw Mom's button do nothing
     * twice: if the prompt hasn't covered the app a moment later, ask again
     * once. A second tap while it's opening doesn't ask twice.
     */
    private fun showScreenPrompt(retry: Boolean = true) {
        val now = System.currentTimeMillis()
        if (now - askedAt < PROMPT_WAIT_MS) return
        askedAt = now
        val projection = getSystemService(MediaProjectionManager::class.java)
        // Always the whole screen: newer Android offers "one app" by
        // default, which would hide most of the phone from the helper
        // and put their taps in the wrong place.
        askToShareScreen.launch(
            if (Build.VERSION.SDK_INT >= 34) {
                projection.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            } else {
                projection.createScreenCaptureIntent()
            },
        )
        if (retry) {
            window.decorView.postDelayed({
                val stillHere = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
                if (askedAt == now && stillHere) {
                    askedAt = 0L
                    showScreenPrompt(retry = false)
                }
            }, PROMPT_WAIT_MS)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Android only lets an app read the clipboard while it has focus.
        if (hasFocus) pickUpCopiedInvite()
    }

    /**
     * After a first install, the invite page has copied the invite link (see
     * web/src/join.js), so nobody has to find the text and tap it again. Only
     * looked at while this phone waits to be linked; the invite still goes
     * through "Link with ...?" and the picture check. Cleared once used.
     */
    private fun pickUpCopiedInvite() {
        if (!vm.wantsCopiedInvite()) return
        val clipboard = getSystemService(ClipboardManager::class.java) ?: return
        val description = clipboard.primaryClipDescription ?: return
        if (!description.hasMimeType("text/*")) return
        val text = try {
            clipboard.primaryClip?.getItemAt(0)?.text?.toString()
        } catch (e: SecurityException) {
            null
        }
        val invite = inviteFromCopiedText(text, Updater.sites(this)) ?: return
        if (vm.handleCopiedInvite(invite) && Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip()
    }

    /** Opens Messages with a ready-made text; the person picks who gets it. */
    private fun textSomeoneWhoCanHelp() {
        val link = Updater.site(this)?.let { "$it?start=helper" } ?: ""
        val text = "Can you help me with my phone? I'm using My Tech Kid. Start here, then send me an invite link: $link".trim()
        val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", text)
        try {
            startActivity(sms)
        } catch (e: ActivityNotFoundException) {
            // No texting app (a tablet): offer any app that can send it.
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))
        }
    }

    override fun onResume() {
        super.onResume()
        vm.checkForUpdate()
        vm.resumes++
        // Back from turning on the tapping switch: if it's still off, show how to fix it.
        ScreenShareService.active?.onBackFromSwitch()
    }

    private fun askForNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return
                if (data.scheme != "mytechkid" || data.host != "join") return
                val c = data.getQueryParameter("c")
                val i = data.getQueryParameter("i")
                val t = data.getQueryParameter("t")
                if (c.isNullOrBlank() || i.isNullOrBlank() || t.isNullOrBlank()) return
                vm.handleInviteLink(InviteLink(c, i, t))
            }
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                vm.handleSharedText(text)
            }
        }
    }

    private companion object {
        const val PROMPT_WAIT_MS = 1500L
    }
}

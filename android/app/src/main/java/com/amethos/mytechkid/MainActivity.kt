package com.amethos.mytechkid

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.provider.Settings
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.amethos.mytechkid.ask.AskService
import com.amethos.mytechkid.ui.PhoneActions
import com.amethos.mytechkid.ui.TechKidScreens
import com.amethos.mytechkid.ui.TechKidTheme

class MainActivity : ComponentActivity() {
    private val vm: TechKidViewModel by viewModels()

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Android's own photo picker: no "Allow photos" question for Mom.
    private val pickPicture =
        registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::handleSharedImage) }

    private val phoneActions = PhoneActions(
        pickPicture = { pickPicture.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        openAccessibility = ::openAccessibilitySettings,
        openAppInfo = {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        },
    )
    // Android's own "Start sharing?" prompt. Mom must say yes every time.
    private val askToShareScreen =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) vm.startScreenShare(this, data)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        // First time, the intro screen explains notifications before Android asks.
        if (vm.introSeen()) askForNotificationsIfNeeded()
        setContent {
            TechKidTheme {
                TechKidScreens(
                    vm,
                    phoneActions,
                    onIntroDone = {
                        askForNotificationsIfNeeded()
                        vm.finishIntro()
                    },
                    onShowScreen = {
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
                    },
                    onStopScreen = { ScreenShareService.stop(this) },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.checkForUpdate()
        vm.refreshAskButton()
    }

    /** Straight to My Tech Kid's switch where the phone allows it, otherwise the Accessibility page. */
    private fun openAccessibilitySettings() {
        val component = ComponentName(this, AskService::class.java).flattenToString()
        val direct = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
            .putExtra(Intent.EXTRA_COMPONENT_NAME, component)
        try {
            startActivity(direct)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
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
                if (intent.type?.startsWith("image/") == true) {
                    val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: return
                    vm.handleSharedImage(uri)
                    return
                }
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                vm.handleSharedText(text)
            }
            ACTION_ASK_PICTURE -> {
                val name = intent.getStringExtra(EXTRA_PICTURE) ?: return
                vm.handleAskPicture(name, intent.getBooleanExtra(EXTRA_COVERED, false))
            }
        }
    }

    companion object {
        /** From the ask button (ask/AskService.kt): a picture waiting for Mom's "Send". */
        const val ACTION_ASK_PICTURE = "com.amethos.mytechkid.ASK_PICTURE"
        const val EXTRA_PICTURE = "picture"
        const val EXTRA_COVERED = "covered"
    }
}

package com.amethos.mytechkid

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import com.amethos.mytechkid.ui.TechKidScreens
import com.amethos.mytechkid.ui.TechKidTheme

class MainActivity : ComponentActivity() {
    private val vm: TechKidViewModel by viewModels()

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

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
}

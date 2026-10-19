package com.amethos.mytechkid

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
                    onTextHelper = ::textSomeoneWhoCanHelp,
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.checkForUpdate()
    }

    private fun askForNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** Opens Messages with a ready-made text; the person picks who gets it. */
    private fun textSomeoneWhoCanHelp() {
        val link = Updater.site(this)?.let { "${it}?start=helper" } ?: ""
        val text = "Can you help me with my phone? I'm using My Tech Kid. Start here and then send me an invite link: $link".trim()
        val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", text)
        try {
            startActivity(sms)
        } catch (e: ActivityNotFoundException) {
            // No texting app (a tablet): offer any app that can send it.
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))
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

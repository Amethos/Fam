package com.amethos.mytechkid.ui

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import com.amethos.mytechkid.R
import com.amethos.mytechkid.TechKidViewModel
import com.amethos.mytechkid.ScamCheck
import com.amethos.mytechkid.Screen
import com.amethos.mytechkid.Talk
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.LocalContext
import com.amethos.mytechkid.RingService
import com.amethos.mytechkid.RingState
import com.amethos.mytechkid.RemoteControlService
import com.amethos.mytechkid.ScreenShareService
import com.amethos.mytechkid.ShareState
import android.os.Build
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Warm Home (Oct 2026): terracotta, cream and olive, with soft rounded type.
// Mockups: docs/design/DESIGN.md. Calm and high-contrast; slow, gentle motion.
private val Ink = Color(0xFF3B2A20)
private val Muted = Color(0xFF6B5444)
private val Ground = Color(0xFFF5F0E1)
private val Card = Color(0xFFFFFBF3)
private val Clay = Color(0xFFA3532F)
private val OnClay = Color(0xFFFFF8EE)
private val Olive = Color(0xFF5C6B30)
private val Sand = Color(0xFFE8DCC4)
private val ClaySoft = Color(0xFFF6E3D0)
private val ClayInk = Color(0xFF6E3A1E)
private val Line = Color(0xFFD9CBAE)
private val InfoSoft = Color(0xFFEFE6D2)
private val Red = Color(0xFF9C2F1E)
private val RedSoft = Color(0xFFF6DDD6)
private val RedInk = Color(0xFF5E1B12)
private val Green = Color(0xFF1F6B45)
private val GreenSoft = Color(0xFFE1EBD9)

// Varela Round for headings and the big buttons, Nunito Sans for everything
// else. Bundled (res/font, licenses in android/third_party/fonts) so they
// work offline. Sizes are in sp, so they grow with the phone's font size.
private val Rounded = FontFamily(Font(R.font.varela_round))
private val Sans = FontFamily(
    Font(R.font.nunito_sans_400, FontWeight.Normal),
    Font(R.font.nunito_sans_700, FontWeight.Bold),
    Font(R.font.nunito_sans_800, FontWeight.ExtraBold),
)
private val WarmType = Typography().run {
    copy(
        displayLarge = displayLarge.copy(fontFamily = Sans), displayMedium = displayMedium.copy(fontFamily = Sans),
        displaySmall = displaySmall.copy(fontFamily = Sans), headlineLarge = headlineLarge.copy(fontFamily = Sans),
        headlineMedium = headlineMedium.copy(fontFamily = Sans), headlineSmall = headlineSmall.copy(fontFamily = Sans),
        titleLarge = titleLarge.copy(fontFamily = Sans), titleMedium = titleMedium.copy(fontFamily = Sans),
        titleSmall = titleSmall.copy(fontFamily = Sans), bodyLarge = bodyLarge.copy(fontFamily = Sans),
        bodyMedium = bodyMedium.copy(fontFamily = Sans), bodySmall = bodySmall.copy(fontFamily = Sans),
        labelLarge = labelLarge.copy(fontFamily = Sans), labelMedium = labelMedium.copy(fontFamily = Sans),
        labelSmall = labelSmall.copy(fontFamily = Sans),
    )
}

@Composable
fun TechKidTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = Clay, onPrimary = OnClay, background = Ground, surface = Card, onSurface = Ink),
        typography = WarmType,
        content = content,
    )
}

@Composable
fun TechKidScreens(
    vm: TechKidViewModel,
    onIntroDone: () -> Unit,
    onShowScreen: () -> Unit = {},
    onStopScreen: () -> Unit = {},
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Ground)
            .safeDrawingPadding(),
    ) {
        when (val s = vm.screen) {
            Screen.Loading -> Centered { CircularProgressIndicator() }
            Screen.NotConfigured -> Page {
                Title("Almost there")
                Body("This copy of My Tech Kid isn't connected yet. Your family needs to finish setup (docs/SETUP.md).")
            }
            is Screen.Welcome -> WelcomeScreen(s.message)
            is Screen.InviteAsk -> InviteAskScreen(vm, s)
            is Screen.Pictures -> PicturesScreen(vm, s)
            Screen.Intro -> IntroScreen(vm, onIntroDone)
            Screen.Home -> HomeScreen(vm, onShowScreen, onStopScreen)
            Screen.Talk -> TalkScreen(vm)
            is Screen.Scam -> ScamScreen(vm, s.draft)
        }
    }
}

// ---------- Building blocks ----------

// Fades and settles in slowly the first time it appears: calm, no bounce,
// on this side. Turns itself off when "Remove animations" is on, because
// Compose follows that setting.
@Composable
private fun Modifier.popIn(delayMillis: Long = 0): Modifier {
    val scale = remember { Animatable(0.94f) }
    val fade = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(delayMillis)
        launch { fade.animateTo(1f, tween(450)) }
        scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessVeryLow))
    }
    return this.graphicsLayer {
        scaleX = scale.value
        scaleY = scale.value
        alpha = fade.value
    }
}

// A slowly breathing dot: shows Mom her request is still going out.
@Composable
private fun LiveDot(color: Color) {
    val pulse by rememberInfiniteTransition(label = "live").animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "pulse",
    )
    Box(
        Modifier
            .size(18.dp)
            .graphicsLayer { alpha = pulse; scaleX = 0.8f + pulse * 0.2f; scaleY = 0.8f + pulse * 0.2f }
            .background(color, CircleShape),
    )
}

@Composable
private fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        content = content,
    )
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Title(text: String) {
    Text(text, fontFamily = Rounded, fontSize = 32.sp, lineHeight = 38.sp, color = Ink)
}

@Composable
private fun Body(text: String, color: Color = Muted) {
    Text(text, fontSize = 21.sp, lineHeight = 30.sp, color = color)
}

@Composable
private fun BigButton(text: String, color: Color = Clay, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 76.dp),
        shape = RoundedCornerShape(38.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = OnClay),
    ) {
        Text(text, fontSize = 23.sp, lineHeight = 28.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
    }
}

@Composable
private fun QuietButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp),
        shape = RoundedCornerShape(32.dp),
        border = BorderStroke(2.dp, Line),
    ) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Panel(background: Color, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(28.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

// Their helper's initial. On the help button it sits cream on terracotta.
@Composable
private fun Avatar(name: String, size: Int, onClay: Boolean = false) {
    Box(
        Modifier
            .size(size.dp)
            .background(if (onClay) Ground else Clay, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifEmpty { "?" },
            fontFamily = Rounded,
            fontSize = (size / 2.1).sp,
            color = if (onClay) Clay else OnClay,
        )
    }
}

// Inside the big help button: their helper's initial, "Tap for help", "from Josh".
@Composable
private fun HelpButtonLabel(helper: String, avatar: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Avatar(helper, avatar, onClay = true)
        Text("Tap for help", fontFamily = Rounded, fontSize = 40.sp, lineHeight = 44.sp, textAlign = TextAlign.Center)
        Text("from $helper", fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
    }
}

/** A shield with a check mark, drawn in code so no icon library is needed. */
@Composable
private fun Shield(color: Color, size: Int) {
    Canvas(Modifier.size(size.dp)) {
        val w = this.size.width
        val h = this.size.height
        val outline = Path().apply {
            moveTo(w * 0.5f, h * 0.08f)
            lineTo(w * 0.85f, h * 0.22f)
            lineTo(w * 0.85f, h * 0.5f)
            cubicTo(w * 0.85f, h * 0.72f, w * 0.7f, h * 0.86f, w * 0.5f, h * 0.92f)
            cubicTo(w * 0.3f, h * 0.86f, w * 0.15f, h * 0.72f, w * 0.15f, h * 0.5f)
            lineTo(w * 0.15f, h * 0.22f)
            close()
        }
        val check = Path().apply {
            moveTo(w * 0.37f, h * 0.5f)
            lineTo(w * 0.46f, h * 0.59f)
            lineTo(w * 0.63f, h * 0.41f)
        }
        drawPath(outline, color, style = Stroke(width = w * 0.08f, join = StrokeJoin.Round))
        drawPath(check, color, style = Stroke(width = w * 0.08f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable
private fun ErrorText(vm: TechKidViewModel) {
    vm.error?.let { Text(it, fontSize = 19.sp, color = Red, fontWeight = FontWeight.Bold) }
}

private fun names(list: List<String>): String = when (list.size) {
    0 -> "your family"
    1 -> list[0]
    else -> list.dropLast(1).joinToString(", ") + " or " + list.last()
}

// ---------- Screens ----------

@Composable
private fun WelcomeScreen(message: String?) {
    Page {
        Spacer(Modifier.heightIn(min = 24.dp))
        Title("Welcome to My Tech Kid")
        if (message != null) Panel(ClaySoft) { Body(message, ClayInk) }
        Body("My Tech Kid puts a big button on your phone that reaches your family when you need help.")
        Body("To get started, ask your family to text you an invite link. Then tap the link in your messages.")
    }
}

@Composable
private fun InviteAskScreen(vm: TechKidViewModel, s: Screen.InviteAsk) {
    Page {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(s.helperName, 120)
        }
        Title("Link with ${s.helperName}?")
        Panel(ClaySoft) {
            Text(
                "Only continue if you know ${s.helperName} personally and trust them with your phone.",
                fontSize = 21.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, color = ClayInk,
            )
            Body("Once linked, each time you tap Start, ${s.helperName} can see your screen and tap on it for you. You can stop at any time.", ClayInk)
            Body("Banks, Samsung, Google, Microsoft and the police will never ask you to use this app.", ClayInk)
        }
        ErrorText(vm)
        BigButton("I know ${s.helperName}, continue", enabled = !vm.busy) { vm.acceptInvite() }
        QuietButton("I don't know this person", enabled = !vm.busy) { vm.rejectInvite() }
    }
}

@Composable
private fun PicturesScreen(vm: TechKidViewModel, s: Screen.Pictures) {
    Page {
        if (s.confirmed) {
            Title("Almost done")
            Body("Waiting for ${s.helperName} to tap \"They match\" on their phone.")
        } else {
            Title("Call ${s.helperName} and check these pictures")
            Body("${s.helperName} should see the same three pictures.")
        }
        s.pictures.forEach { p ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Card, RoundedCornerShape(20.dp))
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(p.emoji, fontSize = 44.sp)
                Text(p.label, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Ink)
            }
        }
        ErrorText(vm)
        if (!s.confirmed) {
            BigButton("They match", color = Green, enabled = !vm.busy) { vm.confirmPictures(true) }
            QuietButton("They don't match — stop", enabled = !vm.busy) { vm.confirmPictures(false) }
        }
    }
}

@Composable
private fun IntroScreen(vm: TechKidViewModel, onDone: () -> Unit) {
    val first = vm.helperNames.firstOrNull() ?: "Your family"
    val practice = vm.practiceHelp
    Page {
        when (practice?.status) {
            // Step 1: meet the button, and try it once for real.
            null -> {
                Title("This is your help button")
                Body("Let's try it once together. Tap it now. $first will see it's just practice.", Ink)
                Button(
                    onClick = { vm.tryPractice() },
                    enabled = !vm.busy,
                    modifier = Modifier
                        .popIn(250)
                        .fillMaxWidth()
                        .heightIn(min = 300.dp),
                    shape = RoundedCornerShape(40.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Clay, contentColor = OnClay),
                    elevation = ButtonDefaults.buttonElevation(defaultElevation = 8.dp),
                ) {
                    HelpButtonLabel(first, avatar = 104)
                }
                ErrorText(vm)
                QuietButton("Not now") { onDone() }
            }
            // Step 2: waiting for the helper's "Got it".
            "waiting" -> {
                Title("Asking $first…")
                Panel(InfoSoft) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        LiveDot(Clay)
                        Text("$first's phone is buzzing", fontFamily = Rounded, fontSize = 24.sp, lineHeight = 30.sp, color = Ink)
                    }
                    Body("When $first taps Got it, you'll see it here.", Ink)
                }
                QuietButton("Not now") { onDone() }
            }
            // Step 3: it worked.
            else -> {
                Box(Modifier.popIn()) {
                    Panel(GreenSoft) {
                        Avatar(first, 72)
                        Text("$first got it!", fontFamily = Rounded, fontSize = 32.sp, color = Ink)
                        Body("That's all there is to it. Whenever you're stuck on your phone, tap your button and $first will call you.", Ink)
                    }
                }
                Panel(ClaySoft) {
                    Body("Next, your phone will ask about notifications. Tap Allow so you can see $first's answers.", ClayInk)
                }
                BigButton("OK, got it") { onDone() }
            }
        }
    }
}

@Composable
private fun HomeScreen(vm: TechKidViewModel, onShowScreen: () -> Unit, onStopScreen: () -> Unit) {
    val helpers = names(vm.helperNames)
    val first = vm.helperNames.firstOrNull() ?: "Family"
    val help = vm.activeHelp
    Page {
        val hour = LocalTime.now().hour
        val greeting = when {
            hour < 12 -> "Good morning"
            hour < 18 -> "Good afternoon"
            else -> "Good evening"
        }
        val today = LocalDate.now()
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(today.format(DateTimeFormatter.ofPattern("EEEE", Locale.getDefault())), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Olive)
            Text(today.format(DateTimeFormatter.ofPattern("MMMM d", Locale.getDefault())), fontFamily = Rounded, fontSize = 40.sp, lineHeight = 44.sp, color = Ink)
            Text(
                if (vm.myName.isNotBlank()) "$greeting, ${vm.myName}" else greeting,
                fontSize = 22.sp, lineHeight = 28.sp, color = Muted, modifier = Modifier.padding(top = 6.dp),
            )
        }
        ErrorText(vm)
        if (vm.updateReady) UpdatePanel(vm)
        val ringer = RingState.ringingFrom
        if (ringer != null) RingingPanel(ringer)
        val watcher = ShareState.watcher
        if (!watcher.isNullOrBlank() && ShareState.controlAsk) TapSetupPanel(watcher)
        if (watcher != null) SharingPanel(watcher, onStopScreen)
        when (help?.status) {
            "waiting" -> Panel(InfoSoft) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LiveDot(Clay)
                    Text("Asking $helpers for help…", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
                }
                if (help.hasVoice) {
                    Body("They got your voice message.", Ink)
                    vm.lastSaid?.takeIf { it.first == help.id }?.let { (_, said) ->
                        Text("You said", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, color = Olive)
                        Quote("\u201C$said\u201D")
                    }
                } else {
                    Body("They're getting an alert on their phone right now.")
                }
                QuietButton("Never mind, I'm OK", enabled = !vm.busy) { vm.finishHelp("cancelled") }
            }
            "accepted" -> Box(Modifier.popIn()) { Panel(GreenSoft) {
                val helper = help.helperName ?: first
                // "I'm on it" starts the help: Android's own "Share your screen?"
                // comes up by itself once, a moment after this card, and only
                // their tap on Start shares anything. Cancel leaves the button below.
                val activity = LocalContext.current as? ComponentActivity
                if (watcher == null) {
                    LaunchedEffect(help.id, vm.resumes) {
                        delay(2500)
                        val onScreen = activity?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
                        if (onScreen && ShareState.watcher == null && vm.firstShareAsk(help.id)) onShowScreen()
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(helper, 56)
                    Text("$helper is coming to help", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
                }
                // Start is Mom's one yes: to seeing and to tapping.
                Body(
                    if (watcher == null) "Tap Start on the next screen so $helper can see your screen and tap on it for you. You can stop any time."
                    else "They'll call you in a moment.",
                    Ink,
                )
                if (watcher == null) BigButton("Show ${help.helperName ?: first} my screen", color = Green) { onShowScreen() }
                QuietButton("All fixed, thank you", enabled = !vm.busy) { vm.finishHelp("done") }
            } }
            else -> Button(
                onClick = { vm.askForHelp() },
                enabled = !vm.busy,
                modifier = Modifier
                    .popIn(120)
                    .fillMaxWidth()
                    .heightIn(min = 340.dp),
                shape = RoundedCornerShape(40.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Clay, contentColor = OnClay),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 8.dp),
            ) {
                HelpButtonLabel(first, avatar = 116)
            }
        }
        Button(
            onClick = { vm.openScamCheck() },
            modifier = Modifier
                .popIn(320)
                .fillMaxWidth()
                .heightIn(min = 128.dp),
            shape = RoundedCornerShape(40.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Sand, contentColor = Ink),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Shield(Olive, 44)
                Column {
                    Text("Is this a scam?", fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.ExtraBold)
                    Text("Ask before you tap or pay", fontSize = 18.sp, color = Muted)
                }
            }
        }
    }
}

// Always visible while the screen is shared: who can see it, and a big Stop.
@Composable
private fun SharingPanel(watcher: String, onStop: () -> Unit) {
    Panel(ClaySoft) {
        if (watcher.isBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LiveDot(Clay)
                Text("Getting your screen ready…", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(watcher, 56)
                Text("$watcher is helping you", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LiveDot(Green)
                    Body("$watcher can see your screen", Ink)
                }
                if (ShareState.controlling) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LiveDot(Green)
                    Body("$watcher can tap for you", Ink)
                }
            }
        }
        Body("Banking and password screens stay hidden. Nothing is recorded.", ClayInk)
        BigButton("Stop", color = Red) { onStop() }
    }
}

// The helper asked to tap and the switch is still off: a one-time setup,
// shown in pictures while the helper talks them through it on the phone.
// The first card is also the disclosure Google requires before the switch.
@Composable
private fun TapSetupPanel(watcher: String) {
    val context = LocalContext.current
    val share = ScreenShareService.active
    Box(Modifier.popIn()) {
        Panel(Card) {
            if (ShareState.setupBlocked) {
                Text("Did your phone say \"Restricted setting\"?", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
                RestrictedPicture()
                Body("That's normal for apps from a link. It takes three taps to fix:", Ink)
                SetupStep(1, "Tap Take me there below")
                SetupStep(2, "Tap ⋮ in the top corner")
                SetupStep(3, "Tap Allow restricted settings")
                BigButton("Take me there", color = Green) { RemoteControlService.openAppInfo(context) }
                Body("Then come back here and tap Turn it on.")
                QuietButton("Turn it on") { RemoteControlService.openSwitch(context) }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(watcher, 56)
                    Text("$watcher wants to tap on your phone for you", fontFamily = Rounded, fontSize = 24.sp, lineHeight = 30.sp, color = Ink)
                }
                Body("You only do this once. $watcher will walk you through it on the phone.", Ink)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Samsung calls the list "Installed apps"; most other phones "Downloaded apps".
                    val list = if (Build.MANUFACTURER.equals("samsung", ignoreCase = true)) "Installed apps" else "Downloaded apps"
                    SetupPicture("1. Tap $list") { ListPicture() }
                    SetupPicture("2. Tap My Tech Kid") { AppPicture() }
                    SetupPicture("3. Turn the switch on") { SwitchPicture() }
                }
                Text(
                    "Turning on \"My Tech Kid: let family tap for me\" lets $watcher tap for you. " +
                        "$watcher's taps only work while you show your screen, which you start each time with Start. " +
                        "My Tech Kid doesn't read or save what's on your screen.",
                    fontSize = 17.sp, lineHeight = 24.sp, color = Muted,
                )
                BigButton("Agree and show me where", color = Green) {
                    share?.onSwitchOpened()
                    RemoteControlService.openSwitch(context)
                }
                QuietButton("Not now") { share?.onSetupNotNow() }
            }
        }
    }
}

@Composable
private fun SetupStep(number: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(36.dp).background(Clay, CircleShape), contentAlignment = Alignment.Center) {
            Text("$number", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = OnClay)
        }
        Text(text, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
    }
}

@Composable
private fun RowScope.SetupPicture(label: String, picture: @Composable () -> Unit) {
    Column(
        Modifier.weight(1f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(84.dp)
                .background(InfoSoft, RoundedCornerShape(14.dp))
                .padding(8.dp),
            contentAlignment = Alignment.Center,
        ) { picture() }
        Text(label, fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.ExtraBold, color = Ink, textAlign = TextAlign.Center)
    }
}

// Little drawings of the settings screens, so there's nothing to read.
@Composable
private fun ListPicture() {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.fillMaxWidth().height(12.dp).background(Line, RoundedCornerShape(4.dp)))
        Box(Modifier.fillMaxWidth().height(18.dp).background(Clay, RoundedCornerShape(6.dp)))
        Box(Modifier.fillMaxWidth().height(12.dp).background(Line, RoundedCornerShape(4.dp)))
    }
}

@Composable
private fun AppPicture() {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(34.dp).background(Clay, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text("tk.", fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = OnClay)
        }
        Box(Modifier.width(48.dp).height(8.dp).background(Clay, RoundedCornerShape(4.dp)))
    }
}

@Composable
private fun SwitchPicture() {
    Box(Modifier.width(56.dp).height(32.dp).background(Green, RoundedCornerShape(16.dp)).padding(4.dp), contentAlignment = Alignment.CenterEnd) {
        Box(Modifier.size(24.dp).background(Color.White, CircleShape))
    }
}

// What Android's block looks like, so it's easy to recognize.
@Composable
private fun RestrictedPicture() {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFF2B2B2E), RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Restricted setting", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
        Text("For your security, this setting is currently unavailable.", fontSize = 15.sp, lineHeight = 20.sp, color = Color(0xFFD4D4D8))
        Text("OK", fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = Color(0xFF8AB4FF), modifier = Modifier.align(Alignment.End))
    }
}

@Composable
private fun RingingPanel(helper: String) {
    val context = LocalContext.current
    Panel(ClaySoft) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LiveDot(Clay)
            Text("$helper is ringing your phone", fontFamily = Rounded, fontSize = 26.sp, lineHeight = 32.sp, color = Ink)
        }
        BigButton("Found it", color = Green) { RingService.stop(context) }
    }
}

// Beta only: appears when a newer My Tech Kid is on the website (Updater.kt).
@Composable
private fun UpdatePanel(vm: TechKidViewModel) {
    Box(Modifier.popIn()) {
        Panel(ClaySoft) {
            Text("A new My Tech Kid is ready", fontFamily = Rounded, fontSize = 24.sp, lineHeight = 30.sp, color = ClayInk)
            if (vm.updating) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = ClayInk, strokeWidth = 3.dp)
                    Body("Getting it now…", ClayInk)
                }
            } else {
                Body("Tap Update, then tap Update again on the next screen.", ClayInk)
                BigButton("Update", color = Clay) { vm.startUpdate() }
            }
        }
    }
}

@Composable
private fun ScamScreen(vm: TechKidViewModel, draft: String) {
    BackHandler { vm.goHome() }
    var text by remember(draft) { mutableStateOf(draft) }
    val latest: ScamCheck? = vm.scamChecks.firstOrNull()
    val helpers = names(vm.helperNames)
    Page {
        Title("Is this a scam?")
        if (latest != null && draft.isEmpty()) {
            LatestAnswer(latest, helpers)
        }
        Body("Paste or type the message you got. Tip: in Messages, press and hold a text, tap Share, then choose My Tech Kid.")
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 140.dp),
            textStyle = TextStyle(fontSize = 20.sp, color = Ink),
            placeholder = { Text("The message goes here", fontSize = 20.sp) },
        )
        ErrorText(vm)
        BigButton("Send to $helpers", enabled = !vm.busy && text.isNotBlank()) {
            vm.sendScamCheck(text)
            text = ""
        }
        QuietButton("Back to home") { vm.goHome() }
    }
}

// After Tap for help: say what's wrong first, then it all goes to the helper in
// one alert. The microphone is on only while the red bar shows.
@Composable
private fun TalkScreen(vm: TechKidViewModel) {
    BackHandler { vm.leaveTalk() }
    val first = vm.helperNames.firstOrNull() ?: "your family"
    val context = LocalContext.current
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) vm.startTalking() else vm.askWithoutTalking()
    }
    val tapMic = {
        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (allowed) vm.startTalking() else askMic.launch(Manifest.permission.RECORD_AUDIO)
    }
    Page {
        when (val talk = vm.talk) {
            Talk.Ready -> {
                Row(Modifier.popIn(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(first, 56)
                    Title("What do you need help with?")
                }
                Column(
                    Modifier.popIn(200).fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    MicButton(enabled = !vm.busy, label = "Tell $first what's wrong", onClick = tapMic)
                    Text("Tell $first\nwhat's wrong", fontFamily = Rounded, fontSize = 30.sp, lineHeight = 36.sp, color = Ink, textAlign = TextAlign.Center)
                    Body("Tap and talk. Only $first will hear it.")
                }
                ErrorText(vm)
                QuietButton("Just ask $first to call me", enabled = !vm.busy) { vm.askWithoutTalking() }
            }
            is Talk.Recording -> {
                Row(
                    Modifier.fillMaxWidth().background(Red, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    LiveDot(OnClay)
                    Text("$first will hear this", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = OnClay)
                }
                Title("I'm listening…")
                Text(
                    "%d:%02d".format(talk.seconds / 60, talk.seconds % 60),
                    fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = Ink,
                    modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                )
                Body("Tap Send when you're done talking.")
                BigButton("Send to $first") { vm.finishTalking() }
            }
            Talk.Sending -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(color = Clay)
                    Title("Sending to $first…")
                }
            }
        }
    }
}

/** A big round terracotta button with a microphone drawn in code. */
@Composable
private fun MicButton(enabled: Boolean, label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(170.dp)
            .background(ClaySoft, CircleShape)
            .padding(16.dp)
            .background(if (enabled) Clay else Line, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(64.dp)) {
            val w = size.width
            val h = size.height
            drawRoundRect(
                OnClay,
                topLeft = androidx.compose.ui.geometry.Offset(w * 0.36f, h * 0.06f),
                size = androidx.compose.ui.geometry.Size(w * 0.28f, h * 0.52f),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.14f),
            )
            val stand = Path().apply {
                moveTo(w * 0.2f, h * 0.44f)
                cubicTo(w * 0.2f, h * 0.9f, w * 0.8f, h * 0.9f, w * 0.8f, h * 0.44f)
                moveTo(w * 0.5f, h * 0.77f)
                lineTo(w * 0.5f, h * 0.95f)
            }
            drawPath(stand, OnClay, style = Stroke(width = w * 0.08f, cap = StrokeCap.Round))
        }
    }
}

@Composable
private fun LatestAnswer(check: ScamCheck, helpers: String) {
    when (check.verdict) {
        null -> Panel(InfoSoft) {
            Text("Waiting for $helpers to answer…", fontFamily = Rounded, fontSize = 24.sp, lineHeight = 30.sp, color = Ink)
            Body("Don't tap any links or pay anything until they do.", Ink)
            Quote(check.text)
        }
        "safe" -> Panel(GreenSoft) {
            Text("${check.answeredByName}: It's safe", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = Green)
            if (!check.note.isNullOrBlank()) Body("\"${check.note}\"", Ink)
            Quote(check.text)
        }
        else -> Panel(RedSoft) {
            val headline = if (check.verdict == "scam") "Scam — don't tap it" else "Not sure — don't tap it yet"
            Text("${check.answeredByName}: $headline", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = RedInk)
            if (!check.note.isNullOrBlank()) Body("\"${check.note}\"", RedInk)
            Quote(check.text)
        }
    }
}

@Composable
private fun Quote(text: String) {
    Text(
        text.take(300),
        fontSize = 17.sp,
        color = Muted,
        modifier = Modifier
            .fillMaxWidth()
            .background(Card, RoundedCornerShape(14.dp))
            .padding(12.dp),
    )
}

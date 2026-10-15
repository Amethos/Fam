package com.amethos.mytechkid.ui

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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.amethos.mytechkid.TechKidViewModel
import com.amethos.mytechkid.ScamCheck
import com.amethos.mytechkid.Screen
import androidx.compose.ui.platform.LocalContext
import com.amethos.mytechkid.RingService
import com.amethos.mytechkid.RingState
import com.amethos.mytechkid.ShareState
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Midnight & Amber, light: design 9 ("Today's Date"), Mom's pick for now.
private val Ink = Color(0xFF0E1726)
private val Muted = Color(0xFF4A5568)
private val Ground = Color(0xFFEEF2F8)
private val Navy = Color(0xFF0E1726)
private val Amber = Color(0xFFF2B33D)
private val AmberSoft = Color(0xFFFFF1D6)
private val AmberInk = Color(0xFF5C3A00)
private val AmberDeep = Color(0xFF9A5B00)
private val Line = Color(0xFFC9D3E3)
private val InfoSoft = Color(0xFFE3E9F3)
private val Red = Color(0xFFB3261E)
private val RedSoft = Color(0xFFFCE8E6)
private val RedInk = Color(0xFF5C1712)
private val Green = Color(0xFF1F6B45)
private val GreenSoft = Color(0xFFDCEBDF)

@Composable
fun TechKidTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = Navy, background = Ground, surface = Color.White, onSurface = Ink),
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
            is Screen.Scam -> ScamScreen(vm, s.draft)
        }
    }
}

// ---------- Building blocks ----------

// Grows in with a soft bounce the first time it appears. Turns itself off
// when "Remove animations" is on, because Compose follows that setting.
@Composable
private fun Modifier.popIn(delayMillis: Long = 0): Modifier {
    val scale = remember { Animatable(0.82f) }
    val fade = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(delayMillis)
        launch { fade.animateTo(1f, tween(200)) }
        scale.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
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
    Text(text, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
}

@Composable
private fun Body(text: String, color: Color = Muted) {
    Text(text, fontSize = 21.sp, lineHeight = 30.sp, color = color)
}

@Composable
private fun BigButton(text: String, color: Color = Navy, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 76.dp),
        shape = RoundedCornerShape(20.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White),
    ) {
        Text(text, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
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
        shape = RoundedCornerShape(20.dp),
    ) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Panel(background: Color, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(24.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
private fun Avatar(name: String, size: Int) {
    Box(
        Modifier
            .size(size.dp)
            .background(Amber, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifEmpty { "?" },
            fontSize = (size / 2.4).sp,
            fontWeight = FontWeight.ExtraBold,
            color = Navy,
        )
    }
}

/** A shield with "!" drawn in code, so no icon library is needed. */
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
        drawPath(outline, color, style = Stroke(width = w * 0.09f, join = StrokeJoin.Round))
        drawLine(color, Offset(w * 0.5f, h * 0.33f), Offset(w * 0.5f, h * 0.58f), strokeWidth = w * 0.09f, cap = StrokeCap.Round)
        drawCircle(color, radius = w * 0.055f, center = Offset(w * 0.5f, h * 0.72f))
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
        if (message != null) Panel(AmberSoft) { Body(message, AmberInk) }
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
        Title("${s.helperName} wants to help you with your phone")
        Panel(AmberSoft) {
            Text(
                "Only continue if ${s.helperName} is family you know.",
                fontSize = 21.sp, fontWeight = FontWeight.Bold, color = AmberInk,
            )
            Body("Banks, Samsung, Google, Microsoft and the police will never ask you to use this app.", AmberInk)
        }
        ErrorText(vm)
        BigButton("Yes, ${s.helperName} is my family", enabled = !vm.busy) { vm.acceptInvite() }
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
                    .background(Color.White, RoundedCornerShape(20.dp))
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
                    shape = RoundedCornerShape(32.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Navy, contentColor = Color.White),
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Avatar(first, 104)
                        Text("Get help from\n$first", fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                    }
                }
                ErrorText(vm)
                QuietButton("Not now") { onDone() }
            }
            // Step 2: waiting for the helper's "Got it".
            "waiting" -> {
                Title("Asking $first…")
                Panel(InfoSoft) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        LiveDot(AmberDeep)
                        Text("$first's phone is buzzing", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Ink)
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
                        Text("$first got it!", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Ink)
                        Body("That's all there is to it. Whenever you're stuck on your phone, tap your button and $first will call you.", Ink)
                    }
                }
                Panel(AmberSoft) {
                    Body("Next, your phone will ask about notifications. Tap Allow so you can see $first's answers.", AmberInk)
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
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.getDefault())),
                fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Muted,
            )
            Title(if (vm.myName.isNotBlank()) "$greeting, ${vm.myName}" else greeting)
        }
        ErrorText(vm)
        if (vm.updateReady) UpdatePanel(vm)
        val ringer = RingState.ringingFrom
        if (ringer != null) RingingPanel(ringer)
        val watcher = ShareState.watcher
        if (watcher != null) SharingPanel(watcher, onStopScreen)
        when (help?.status) {
            "waiting" -> Panel(InfoSoft) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LiveDot(AmberDeep)
                    Text("Asking $helpers for help…", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
                }
                Body("They're getting an alert on their phone right now.")
                QuietButton("Never mind, I'm OK", enabled = !vm.busy) { vm.finishHelp("cancelled") }
            }
            "accepted" -> Box(Modifier.popIn()) { Panel(GreenSoft) {
                Text("${help.helperName ?: first} is coming to help", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
                Body("They'll call you in a moment.", Ink)
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
                shape = RoundedCornerShape(32.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Navy, contentColor = Color.White),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Avatar(first, 120)
                    Text("Get help from\n$first", fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
            }
        }
        Button(
            onClick = { vm.openScamCheck() },
            modifier = Modifier
                .popIn(320)
                .fillMaxWidth()
                .heightIn(min = 100.dp),
            shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Ink),
            border = BorderStroke(2.dp, Line),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Shield(AmberDeep, 44)
                Column {
                    Text("Is this a scam?", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("Ask before you tap or pay", fontSize = 18.sp, color = Muted)
                }
            }
        }
    }
}

// Always visible while the screen is shared: who can see it, and a big Stop.
@Composable
private fun SharingPanel(watcher: String, onStop: () -> Unit) {
    Panel(AmberSoft) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LiveDot(AmberDeep)
            Text(
                if (watcher.isBlank()) "Getting your screen ready…" else "$watcher can see your screen",
                fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink,
            )
        }
        Body("Banking and password screens stay hidden. Nothing is recorded.", AmberInk)
        BigButton("Stop showing my screen", color = Red) { onStop() }
    }
}

@Composable
private fun RingingPanel(helper: String) {
    val context = LocalContext.current
    Panel(AmberSoft) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LiveDot(AmberDeep)
            Text("$helper is ringing your phone", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        BigButton("Found it", color = Green) { RingService.stop(context) }
    }
}

// Beta only: appears when a newer My Tech Kid is on the website (Updater.kt).
@Composable
private fun UpdatePanel(vm: TechKidViewModel) {
    Box(Modifier.popIn()) {
        Panel(AmberSoft) {
            Text("A new My Tech Kid is ready", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = AmberInk)
            if (vm.updating) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = AmberInk, strokeWidth = 3.dp)
                    Body("Getting it now…", AmberInk)
                }
            } else {
                Body("Tap Update, then tap Update again on the next screen.", AmberInk)
                BigButton("Update", color = AmberDeep) { vm.startUpdate() }
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

@Composable
private fun LatestAnswer(check: ScamCheck, helpers: String) {
    when (check.verdict) {
        null -> Panel(InfoSoft) {
            Text("Waiting for $helpers to answer…", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Ink)
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
            .background(Color.White.copy(alpha = 0.7f), RoundedCornerShape(14.dp))
            .padding(12.dp),
    )
}

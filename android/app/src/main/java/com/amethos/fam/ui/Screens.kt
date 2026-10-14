package com.amethos.fam.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.amethos.fam.FamViewModel
import com.amethos.fam.ScamCheck
import com.amethos.fam.Screen

private val Ink = Color(0xFF15212E)
private val Muted = Color(0xFF3E4A57)
private val Ground = Color(0xFFF4F6F8)
private val Blue = Color(0xFF1D5BD6)
private val Peach = Color(0xFFFFE2CC)
private val OrangeSoft = Color(0xFFFFF1E6)
private val OrangeInk = Color(0xFF5C2C0A)
private val Red = Color(0xFFB3261E)
private val RedSoft = Color(0xFFFCE8E6)
private val RedInk = Color(0xFF5C1712)
private val Green = Color(0xFF1F6B45)
private val GreenSoft = Color(0xFFDCEBDF)

@Composable
fun FamTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = Blue, background = Ground, surface = Color.White, onSurface = Ink),
        content = content,
    )
}

@Composable
fun FamScreens(vm: FamViewModel) {
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
                Body("This copy of Fam isn't connected yet. Your family needs to finish setup (docs/SETUP.md).")
            }
            is Screen.Welcome -> WelcomeScreen(s.message)
            is Screen.InviteAsk -> InviteAskScreen(vm, s)
            is Screen.Pictures -> PicturesScreen(vm, s)
            Screen.Home -> HomeScreen(vm)
            is Screen.Scam -> ScamScreen(vm, s.draft)
        }
    }
}

// ---------- Building blocks ----------

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
private fun BigButton(text: String, color: Color = Blue, enabled: Boolean = true, onClick: () -> Unit) {
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
            .background(Peach, CircleShape)
            .border(5.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifEmpty { "?" },
            fontSize = (size / 2.4).sp,
            fontWeight = FontWeight.ExtraBold,
            color = Color(0xFF8A4210),
        )
    }
}

@Composable
private fun ErrorText(vm: FamViewModel) {
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
        Title("Welcome to Fam")
        if (message != null) Panel(OrangeSoft) { Body(message, OrangeInk) }
        Body("Fam puts a big button on your phone that reaches your family when you need help.")
        Body("To get started, ask your family to text you an invite link. Then tap the link in your messages.")
    }
}

@Composable
private fun InviteAskScreen(vm: FamViewModel, s: Screen.InviteAsk) {
    Page {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(s.helperName, 120)
        }
        Title("${s.helperName} wants to help you with your phone")
        Panel(OrangeSoft) {
            Text(
                "Only continue if ${s.helperName} is family you know.",
                fontSize = 21.sp, fontWeight = FontWeight.Bold, color = OrangeInk,
            )
            Body("Banks, Samsung, Google, Microsoft and the police will never ask you to use this app.", OrangeInk)
        }
        ErrorText(vm)
        BigButton("Yes, ${s.helperName} is my family", enabled = !vm.busy) { vm.acceptInvite() }
        QuietButton("I don't know this person", enabled = !vm.busy) { vm.rejectInvite() }
    }
}

@Composable
private fun PicturesScreen(vm: FamViewModel, s: Screen.Pictures) {
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
private fun HomeScreen(vm: FamViewModel) {
    val helpers = names(vm.helperNames)
    val first = vm.helperNames.firstOrNull() ?: "Family"
    val help = vm.activeHelp
    Page {
        Title(if (vm.myName.isNotBlank()) "Hi ${vm.myName}" else "Hi there")
        ErrorText(vm)
        when (help?.status) {
            "waiting" -> Panel(Color(0xFFE3ECFB)) {
                Text("Asking $helpers for help…", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
                Body("They're getting an alert on their phone right now.")
                QuietButton("Never mind, I'm OK", enabled = !vm.busy) { vm.finishHelp("cancelled") }
            }
            "accepted" -> Panel(GreenSoft) {
                Text("${help.helperName ?: first} is coming to help", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
                Body("They'll call you in a moment.", Ink)
                QuietButton("All fixed, thank you", enabled = !vm.busy) { vm.finishHelp("done") }
            }
            else -> Button(
                onClick = { vm.askForHelp() },
                enabled = !vm.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 340.dp),
                shape = RoundedCornerShape(32.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Color.White),
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
                .fillMaxWidth()
                .heightIn(min = 100.dp),
            shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(containerColor = OrangeSoft, contentColor = OrangeInk),
        ) {
            Column(Modifier.fillMaxWidth()) {
                Text("Is this a scam?", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text("Ask before you tap or pay", fontSize = 18.sp)
            }
        }
    }
}

@Composable
private fun ScamScreen(vm: FamViewModel, draft: String) {
    BackHandler { vm.goHome() }
    var text by remember(draft) { mutableStateOf(draft) }
    val latest: ScamCheck? = vm.scamChecks.firstOrNull()
    val helpers = names(vm.helperNames)
    Page {
        Title("Is this a scam?")
        if (latest != null && draft.isEmpty()) {
            LatestAnswer(latest, helpers)
        }
        Body("Paste or type the message you got. Tip: in Messages, press and hold a text, tap Share, then choose Fam.")
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
        null -> Panel(Color(0xFFE3ECFB)) {
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

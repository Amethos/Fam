package com.amethos.mytechkid

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Lets the helper tap and swipe on Mom's phone (stage 3), only while she is
 * sharing her screen and only after she taps "Yes" on her own phone.
 *
 * This is Android's accessibility switch for My Tech Kid. On its own it does
 * nothing: it reads nothing on the screen and acts only on taps that arrive
 * from ScreenShareService over the end-to-end encrypted connection. While the
 * helper can tap, a banner with the helper's name and a Stop button stays on
 * top of every app, and taps on that banner or the "Yes" question from the
 * helper are refused, so only Mom can answer or stop.
 */
class RemoteControlService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val windows by lazy { getSystemService(WindowManager::class.java) }
    private var ask: View? = null
    private var banner: View? = null
    private val dots = mutableListOf<View>()

    override fun onServiceConnected() {
        instance = this
        // Mom just turned the switch on because her helper asked: ask her now.
        ScreenShareService.active?.onControlSwitchReady()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        shutDown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        shutDown()
        super.onDestroy()
    }

    private fun shutDown() {
        if (instance === this) instance = null
        hideAll()
        ScreenShareService.active?.onControlSwitchOff()
    }

    // ---------- Mom's question and banner ----------

    /** Asks Mom on her own phone. Only her finger can answer: helper taps are refused while it shows. */
    fun askMom(helper: String, onAnswer: (Boolean) -> Unit) {
        hideAsk()
        var answered = false
        fun answer(yes: Boolean) {
            if (answered) return
            answered = true
            hideAsk()
            onAnswer(yes)
        }
        val box = column(Color.WHITE, 28f).apply {
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(text("$helper wants to tap on your phone for you", 26f, bold = true))
            addView(text("Say yes only if you are on the phone with $helper right now. You can stop any time.", 19f, color = MUTED), gap())
            addView(button("Yes, let $helper tap", GREEN) { answer(true) }, gap())
            addView(button("No", Color.parseColor("#E8ECF3"), Color.parseColor("#0F172A")) { answer(false) }, gap(12))
        }
        val dim = LinearLayout(this).apply {
            setBackgroundColor(Color.parseColor("#990F172A"))
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(16), dp(16), dp(16))
            addView(box, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        ask = dim
        windows.addView(dim, overlayParams(WindowManager.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        // No answer in a minute counts as no.
        main.postDelayed({ answer(false) }, ASK_TIMEOUT_MS)
    }

    fun showBanner(helper: String, onStop: () -> Unit) {
        hideBanner()
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(Color.parseColor("#0F172A"), 40f)
            setPadding(dp(16), dp(6), dp(6), dp(6))
            addView(text("$helper is tapping for you", 17f, bold = true, color = Color.WHITE))
            addView(
                button("Stop", RED, small = true) { onStop() },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .apply { leftMargin = dp(12) },
            )
        }
        banner = bar
        windows.addView(bar, overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            y = statusBarHeight() + dp(4)
        })
    }

    fun hideAll() {
        main.removeCallbacksAndMessages(null)
        hideAsk()
        hideBanner()
        dots.toList().forEach { removeView(it) }
        dots.clear()
    }

    private fun hideAsk() {
        main.removeCallbacksAndMessages(null)
        ask?.let { removeView(it) }
        ask = null
    }

    private fun hideBanner() {
        banner?.let { removeView(it) }
        banner = null
    }

    private fun removeView(v: View) {
        runCatching { windows.removeView(v) }
    }

    // ---------- The helper's taps ----------

    /** Screen size in real pixels; the helper's points arrive as 0..1 of the whole screen. */
    private fun screen(): Rect =
        if (Build.VERSION.SDK_INT >= 30) {
            windows.currentWindowMetrics.bounds
        } else {
            val m = android.util.DisplayMetrics()
            @Suppress("DEPRECATION")
            windows.defaultDisplay.getRealMetrics(m)
            Rect(0, 0, m.widthPixels, m.heightPixels)
        }

    /** A point the helper may tap: never on Mom's question or her Stop banner. */
    private fun allowed(x: Float, y: Float): Boolean {
        if (ask != null) return false
        val b = banner ?: return true
        val at = IntArray(2)
        b.getLocationOnScreen(at)
        val pad = dp(8)
        val r = Rect(at[0] - pad, at[1] - pad, at[0] + b.width + pad, at[1] + b.height + pad)
        return !r.contains(x.toInt(), y.toInt())
    }

    /** A tap, press-and-hold or swipe from (x1, y1) to (x2, y2), all 0..1. Returns false if refused. */
    fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean {
        val s = screen()
        val ax = x1 * s.width(); val ay = y1 * s.height()
        val bx = x2 * s.width(); val by = y2 * s.height()
        if (!allowed(ax, ay)) return false
        val path = Path().apply { moveTo(ax, ay); if (ax != bx || ay != by) lineTo(bx, by) }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(1, MAX_GESTURE_MS))
        val sent = dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
        if (sent) showDot(bx, by)
        return sent
    }

    /** Back, Home, recent apps and the notification shade. */
    fun button(name: String): Boolean {
        if (ask != null) return false
        val action = when (name) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            else -> return false
        }
        return performGlobalAction(action)
    }

    // Shows Mom where her helper tapped. It lets touches pass straight through.
    private fun showDot(x: Float, y: Float) {
        val size = dp(36)
        val dot = View(this).apply { background = rounded(Color.parseColor("#B3F2B33D"), size / 2f, raw = true) }
        val params = overlayParams(size, Gravity.TOP or Gravity.START, width = size).apply {
            flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            this.x = x.toInt() - size / 2
            this.y = y.toInt() - size / 2
        }
        runCatching { windows.addView(dot, params) }.onSuccess {
            dots += dot
            dot.postDelayed({ dots -= dot; removeView(dot) }, 600)
        }
    }

    // ---------- Small view helpers (an overlay can't use Compose easily) ----------

    private fun overlayParams(height: Int, gravity: Int, width: Int = WindowManager.LayoutParams.MATCH_PARENT) =
        WindowManager.LayoutParams(
            width, height,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply { this.gravity = gravity }

    private fun column(bg: Int, radius: Float) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(bg, radius)
    }

    private fun text(value: String, sizeSp: Float, bold: Boolean = false, color: Int = INK) = TextView(this).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun button(label: String, bg: Int, fg: Int = Color.WHITE, small: Boolean = false, onClick: () -> Unit) =
        Button(this).apply {
            text = label
            setAllCaps(false)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (small) 17f else 22f)
            setTextColor(fg)
            background = rounded(bg, if (small) 30f else 24f)
            minHeight = dp(if (small) 44 else 64)
            setPadding(dp(20), 0, dp(20), 0)
            setOnClickListener { onClick() }
        }

    private fun gap(top: Int = 20) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(top) }

    private fun rounded(color: Int, radius: Float, raw: Boolean = false) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = if (raw) radius else dp(radius.toInt()).toFloat()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun statusBarHeight(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dp(24)
    }

    companion object {
        private const val ASK_TIMEOUT_MS = 60_000L
        private const val MAX_GESTURE_MS = 3_000L
        private val INK = Color.parseColor("#0F172A")
        private val MUTED = Color.parseColor("#475569")
        private val GREEN = Color.parseColor("#15803D")
        private val RED = Color.parseColor("#B91C1C")

        /** Set while Mom's accessibility switch for My Tech Kid is on. */
        var instance: RemoteControlService? = null
            private set

        /** Opens Android's accessibility settings, where Mom turns on the switch once. */
        fun openSwitch(context: Context) {
            context.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}

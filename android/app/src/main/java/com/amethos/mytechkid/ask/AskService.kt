package com.amethos.mytechkid.ask

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import androidx.annotation.RequiresApi
import com.amethos.mytechkid.MainActivity
import com.amethos.mytechkid.firstName
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import java.util.concurrent.Executors

/**
 * The ask button: a small see-through tab at the edge of the screen, in every
 * app. When Mom taps it, it takes a picture of her screen (passwords and codes
 * covered up first) and opens My Tech Kid to ask "Send this to Josh?". Nothing
 * is sent without that second tap.
 *
 * It never reads the screen at any other moment, and never taps or types.
 * The helper turns the tab on or off and picks its side (phoneSettings in
 * firestore.rules); Mom turns the service on once, in Android's settings.
 */
class AskService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var tab: AskTab? = null
    private val listeners = mutableListOf<ListenerRegistration>()
    private var userListener: ListenerRegistration? = null
    private var circleId: String? = null

    // What the helper set, and who the button reaches.
    private var askTab = false
    private var side = "right"
    private var blurSecrets = true
    private var helperName = ""
    private var frontApp: CharSequence? = null
    private var busy = false

    override fun onServiceConnected() {
        val me = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val db = FirebaseFirestore.getInstance()
        userListener = db.document("users/$me").addSnapshotListener { snap, _ ->
            val cid = snap?.getString("circleId")
            if (cid == circleId) return@addSnapshotListener
            circleId = cid
            listeners.forEach { it.remove() }
            listeners.clear()
            askTab = false
            if (cid != null) {
                listeners += db.document("circles/$cid/phoneSettings/$me").addSnapshotListener { s, _ ->
                    askTab = s?.getBoolean("askTab") == true
                    side = s?.getString("askTabSide") ?: "right"
                    blurSecrets = s?.getBoolean("blurSecrets") != false
                    refresh()
                }
                listeners += db.document("circles/$cid").addSnapshotListener { s, _ ->
                    @Suppress("UNCHECKED_CAST")
                    val members = s?.get("members") as? Map<String, Map<String, Any?>> ?: emptyMap()
                    @Suppress("UNCHECKED_CAST")
                    val helperIds = s?.get("helperIds") as? List<String> ?: emptyList()
                    helperName = helperIds.firstNotNullOfOrNull { members[it]?.get("name") as? String }?.let(::firstName) ?: ""
                    refresh()
                }
            }
            refresh()
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && event.packageName != null) {
            frontApp = event.packageName
            refresh()
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        userListener?.remove()
        listeners.forEach { it.remove() }
        tab?.remove()
        worker.shutdown()
        super.onDestroy()
    }

    /** Show the tab only when it's on, linked, and not over My Tech Kid itself. */
    private fun refresh() {
        val show = Pictures.supported && askTab && circleId != null && frontApp != packageName
        if (!show) {
            tab?.remove()
            tab = null
            return
        }
        val current = tab
        if (current == null || current.side != side) {
            current?.remove()
            tab = AskTab(this, side, helperName) { capture() }.also { it.add() }
        } else {
            current.setName(helperName)
        }
    }

    private fun capture() {
        if (busy || Build.VERSION.SDK_INT < 30) return
        busy = true
        // Find what to cover while the screen is exactly as Mom sees it.
        val covers = if (blurSecrets) findSecrets() else emptyList()
        tab?.view?.visibility = View.INVISIBLE
        // Let the tab disappear before the picture, so it isn't in it.
        main.postDelayed({ takePicture(covers) }, 150)
    }

    @RequiresApi(30)
    private fun takePicture(covers: List<Rect>) {
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                tab?.view?.visibility = View.VISIBLE
                val hardware = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                // A plain copy we can draw on, before the screen's buffer is let go.
                val bitmap = hardware?.copy(Bitmap.Config.ARGB_8888, true)
                hardware?.recycle()
                result.hardwareBuffer.close()
                if (bitmap == null) return failed()
                worker.execute {
                    cover(bitmap, covers)
                    val file = Pictures.save(this@AskService, bitmap)
                    bitmap.recycle()
                    main.post {
                        busy = false
                        startActivity(
                            Intent(this@AskService, MainActivity::class.java)
                                .setAction(MainActivity.ACTION_ASK_PICTURE)
                                .putExtra(MainActivity.EXTRA_PICTURE, file.name)
                                .putExtra(MainActivity.EXTRA_COVERED, blurSecrets)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }
                }
            }

            override fun onFailure(errorCode: Int) {
                tab?.view?.visibility = View.VISIBLE
                failed()
            }
        })
    }

    private fun failed() {
        busy = false
        Toast.makeText(this, "Couldn't take the picture. Try again.", Toast.LENGTH_LONG).show()
    }

    /** Password boxes, code boxes, and text holding codes or card numbers, in screen coordinates. */
    private fun findSecrets(): List<Rect> {
        val found = mutableListOf<Rect>()
        val roots = try { windows.mapNotNull { it.root } } catch (e: Exception) { listOfNotNull(rootInActiveWindow) }
        var visited = 0
        fun walk(node: AccessibilityNodeInfo?) {
            if (node == null || visited++ > 3000) return
            if (node.packageName != packageName) {
                val secret = node.isPassword ||
                    Secrets.isSecretField(node.viewIdResourceName, node.hintText) ||
                    Secrets.inText(node.text) || Secrets.inText(node.contentDescription)
                if (secret) {
                    val r = Rect()
                    node.getBoundsInScreen(r)
                    if (!r.isEmpty) found += r
                }
            }
            for (i in 0 until node.childCount) walk(node.getChild(i))
        }
        roots.forEach { walk(it) }
        return found
    }

    private fun cover(bitmap: Bitmap, covers: List<Rect>) {
        if (covers.isEmpty()) return
        val canvas = Canvas(bitmap)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(74, 85, 104) }
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.DEFAULT_BOLD
            textAlign = Paint.Align.CENTER
        }
        val pad = 4 * resources.displayMetrics.density
        covers.forEach { r ->
            val box = RectF(r.left - pad, r.top - pad, r.right + pad, r.bottom + pad)
            canvas.drawRoundRect(box, pad * 2, pad * 2, fill)
            label.textSize = minOf(box.height() * 0.45f, TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 14f, resources.displayMetrics))
            if (box.width() > label.textSize * 4) {
                canvas.drawText("Hidden", box.centerX(), box.centerY() + label.textSize / 3, label)
            }
        }
    }
}

/**
 * The tab itself: a small navy half-pill at the screen's edge with the
 * helper's initial. It fades to see-through when not in use. Motion is slow
 * and gentle, and skipped when the phone's "Remove animations" is on.
 */
private class AskTab(
    private val context: Context,
    val side: String,
    private var name: String,
    private val onTap: () -> Unit,
) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private val handler = Handler(Looper.getMainLooper())
    private val dim = Runnable { fadeTo(0.4f) }
    private var fade: ValueAnimator? = null

    val view: View = object : View(context) {
        private val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(225, 14, 23, 38) }
        private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(242, 179, 61) }
        private val letter = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(14, 23, 38)
            typeface = Typeface.DEFAULT_BOLD
            textAlign = Paint.Align.CENTER
        }

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            val r = w
            // Rounded on the inner side only, flush with the screen edge.
            if (side == "left") canvas.drawRoundRect(RectF(-r, 0f, w, h), r, r, body)
            else canvas.drawRoundRect(RectF(0f, 0f, w + r, h), r, r, body)
            val cx = w / 2
            val cy = h / 2
            canvas.drawCircle(cx, cy, w * 0.36f, dot)
            letter.textSize = w * 0.42f
            canvas.drawText(name.take(1).uppercase().ifEmpty { "?" }, cx, cy + letter.textSize / 3, letter)
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { handler.removeCallbacks(dim); fadeTo(1f) }
                MotionEvent.ACTION_UP -> { performClick(); scheduleDim() }
                MotionEvent.ACTION_CANCEL -> scheduleDim()
            }
            return true
        }

        override fun performClick(): Boolean {
            super.performClick()
            onTap()
            return true
        }
    }.apply {
        contentDescription = label()
        alpha = 0.4f
    }

    private fun label() = if (name.isBlank()) "Ask your family about this screen" else "Ask $name about this screen"

    fun setName(newName: String) {
        if (newName == name) return
        name = newName
        view.contentDescription = label()
        view.invalidate()
    }

    fun add() {
        val params = WindowManager.LayoutParams(
            (34 * density).toInt(),
            (72 * density).toInt(),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or (if (side == "left") Gravity.START else Gravity.END)
            y = (context.resources.displayMetrics.heightPixels * 0.38f).toInt()
        }
        wm.addView(view, params)
        // Show clearly at first, then settle into see-through.
        fadeTo(1f)
        scheduleDim()
    }

    fun remove() {
        handler.removeCallbacks(dim)
        fade?.cancel()
        try { wm.removeView(view) } catch (e: Exception) { }
    }

    private fun scheduleDim() {
        handler.removeCallbacks(dim)
        handler.postDelayed(dim, 4000)
    }

    private fun fadeTo(target: Float) {
        fade?.cancel()
        if (!ValueAnimator.areAnimatorsEnabled()) {
            view.alpha = target
            return
        }
        fade = ValueAnimator.ofFloat(view.alpha, target).apply {
            duration = 700
            addUpdateListener { view.alpha = it.animatedValue as Float }
            start()
        }
    }
}

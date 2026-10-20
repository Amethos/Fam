package com.amethos.mytechkid.ask

/**
 * Decides which parts of the screen to cover before a picture leaves Mom's
 * phone: password boxes, one-time codes and card numbers. A fixed rule, never
 * a guess about what Mom wants (plans/app-store-compliance.md 2.1).
 * It errs on the side of covering too much.
 */
object Secrets {
    private val CODE_WORDS = Regex(
        "\\b(code|otp|pin|passcode|password|verif\\w*|security|one[- ]time|log ?in|sign ?in|2fa|cvv|cvc)\\b",
        RegexOption.IGNORE_CASE,
    )
    private val SHORT_NUMBER = Regex("(?<![\\d])\\d{3}[ -]?\\d{1,5}(?![\\d])|(?<![\\d])\\d{4,8}(?![\\d])")
    private val ONLY_NUMBER = Regex("\\s*\\d{3,4}[ -]?\\d{2,4}\\s*")
    private val CARD = Regex("(?<![\\d])(?:\\d[ -]?){12,18}\\d(?![\\d])")
    private val FIELD_NAMES = Regex("otp|passcode|password|pin|cvv|cvc|security.?code|verification", RegexOption.IGNORE_CASE)

    /** Text that holds a code ("Your code is 482913") or a card number. */
    fun inText(text: CharSequence?): Boolean {
        if (text.isNullOrBlank()) return false
        val s = text.toString()
        if (CARD.findAll(s).any { luhn(it.value) }) return true
        if (ONLY_NUMBER.matches(s)) return true
        return CODE_WORDS.containsMatchIn(s) && SHORT_NUMBER.containsMatchIn(s)
    }

    /** A box made for a secret, going by its name or hint ("Enter OTP", "cvv_field"). */
    fun isSecretField(viewId: String?, hint: CharSequence?): Boolean =
        (viewId != null && FIELD_NAMES.containsMatchIn(viewId)) ||
            (hint != null && FIELD_NAMES.containsMatchIn(hint))

    private fun luhn(raw: String): Boolean {
        val digits = raw.filter { it.isDigit() }
        if (digits.length !in 13..19) return false
        var sum = 0
        digits.reversed().forEachIndexed { i, c ->
            var d = c - '0'
            if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9 }
            sum += d
        }
        return sum % 10 == 0
    }
}

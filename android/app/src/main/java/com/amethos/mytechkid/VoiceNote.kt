package com.amethos.mytechkid

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume

/**
 * "Tell Josh what's wrong": records Mom's short voice message, only after she
 * taps the microphone, and turns it into words on her phone (never an outside
 * service) so her helper can read it in a meeting.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var startedAt = 0L
    private val file = File(context.cacheDir, "voice-message.m4a")

    /** Small (AAC, 16 kHz, mono): a minute is about 240 KB, so it fits with the help request. */
    fun start() {
        cancel()
        file.delete()
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(32_000)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release()
            throw e
        }
        recorder = r
        startedAt = System.currentTimeMillis()
    }

    /** How loud it is right now (0 to 32767), to notice when she has finished talking. */
    fun level(): Int = try { recorder?.maxAmplitude ?: 0 } catch (e: Exception) { 0 }

    fun seconds(): Double = if (recorder == null) 0.0 else (System.currentTimeMillis() - startedAt) / 1000.0

    /** Stops and returns the recording, or null if nothing usable was recorded. */
    fun stop(): Recording? {
        val r = recorder ?: return null
        val length = seconds()
        recorder = null
        val ok = try {
            r.stop()
            true
        } catch (e: RuntimeException) {
            false // stopped before any sound was saved
        } finally {
            r.release()
        }
        if (!ok || !file.exists()) return null
        return Recording(file.readBytes(), length, file)
    }

    fun cancel() {
        recorder?.let {
            try { it.stop() } catch (e: RuntimeException) { }
            it.release()
        }
        recorder = null
    }
}

class Recording(val bytes: ByteArray, val seconds: Double, val file: File)

object VoiceWords {
    /**
     * Her words, made on the phone itself (Android 13 and newer, when the phone
     * has on-device speech recognition). Null when that isn't possible; her
     * helper can still play the recording.
     */
    suspend fun transcribe(context: Context, file: File): String? {
        if (Build.VERSION.SDK_INT < 33) return null
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) return null
        val pcm = withContext(Dispatchers.IO) {
            try { decodeToPcm(file) } catch (e: Exception) { null }
        } ?: return null
        return withTimeoutOrNull(30_000) { recognize(context, pcm) }?.trim()?.take(2000)?.ifBlank { null }
    }

    private class Pcm(val bytes: ByteArray, val sampleRate: Int, val channels: Int)

    /** The recording back as plain 16-bit sound samples, which is what the recognizer reads. */
    private fun decodeToPcm(file: File): Pcm? {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: return null.also { extractor.release() }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        val out = ByteArrayOutputStream()
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        try {
            while (true) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val size = extractor.readSampleData(codec.getInputBuffer(inIndex)!!, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        sampleRate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                    outIndex >= 0 -> {
                        val buffer = codec.getOutputBuffer(outIndex)!!
                        val chunk = ByteArray(info.size)
                        buffer.position(info.offset)
                        buffer.get(chunk)
                        out.write(chunk)
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }
        return Pcm(out.toByteArray(), sampleRate, channels)
    }

    private suspend fun recognize(context: Context, pcm: Pcm): String? = withContext(Dispatchers.Main) {
        if (Build.VERSION.SDK_INT < 33) return@withContext null
        suspendCancellableCoroutine { cont ->
            val pipe = ParcelFileDescriptor.createPipe()
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            val parts = mutableListOf<String>()
            var finished = false
            fun finish() {
                if (finished) return
                finished = true
                recognizer.destroy()
                try { pipe[0].close() } catch (e: Exception) { }
                if (cont.isActive) cont.resume(parts.joinToString(" ").ifBlank { null })
            }
            fun add(results: Bundle?) {
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    ?.takeIf { it.isNotBlank() }?.let(parts::add)
            }
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) = finish()
                override fun onResults(results: Bundle?) {
                    add(results)
                    finish()
                }
                override fun onSegmentResults(segmentResults: Bundle) = add(segmentResults)
                override fun onEndOfSegmentedSession() = finish()
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0])
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, pcm.channels)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, pcm.sampleRate)
                // Keep listening past pauses, to the end of the recording.
                putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
            }
            recognizer.startListening(intent)
            Thread {
                try {
                    ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { it.write(pcm.bytes) }
                } catch (e: Exception) {
                    // The recognizer gave up early; whatever it heard is still used.
                }
            }.start()
            cont.invokeOnCancellation {
                android.os.Handler(android.os.Looper.getMainLooper()).post { finish() }
            }
        }
    }
}

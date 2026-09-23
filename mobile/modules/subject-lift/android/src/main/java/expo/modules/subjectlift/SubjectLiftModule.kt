package expo.modules.subjectlift

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.Subject
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * Android counterpart of the iOS Vision "subject lifting": ML Kit Subject
 * Segmentation returns each foreground subject as a bitmap with transparent
 * background, so the garment keeps its original pixels.
 */
class SubjectLiftModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SubjectLift")

    Constant("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.N }

    AsyncFunction("liftSubject") { uri: String, promise: Promise ->
      val path = Uri.parse(uri).path
      val source = path?.let { BitmapFactory.decodeFile(it) }
      if (source == null) {
        promise.reject(CodedException("ERR_IMAGE", "Could not read $uri", null))
        return@AsyncFunction
      }

      val options = SubjectSegmenterOptions.Builder()
        .enableMultipleSubjects(
          SubjectSegmenterOptions.SubjectResultOptions.Builder()
            .enableConfidenceMask()
            .enableSubjectBitmap()
            .build()
        )
        .build()
      val segmenter = SubjectSegmentation.getClient(options)

      segmenter.process(InputImage.fromBitmap(source, 0))
        .addOnSuccessListener { result ->
          try {
            promise.resolve(compose(result.subjects, source.width, source.height))
          } catch (error: Exception) {
            promise.reject(CodedException("ERR_LIFT", error.message, error))
          } finally {
            segmenter.close()
          }
        }
        .addOnFailureListener { error ->
          segmenter.close()
          promise.reject(CodedException("ERR_LIFT", error.message, error))
        }
    }
  }

  /** Keeps subjects at least a quarter the size of the biggest one (drops a hand holding a hanger). */
  private fun compose(subjects: List<Subject>, imageWidth: Int, imageHeight: Int): Map<String, Any>? {
    if (subjects.isEmpty()) return null
    val areas = subjects.map { subject -> subject to maskArea(subject) }
    val largest = areas.maxOf { it.second }
    val kept = areas.filter { it.second >= largest * 0.25 }.map { it.first }.filter { it.bitmap != null }
    if (kept.isEmpty()) return null

    val left = kept.minOf { it.startX }
    val top = kept.minOf { it.startY }
    val right = kept.maxOf { it.startX + it.width }
    val bottom = kept.maxOf { it.startY + it.height }
    val output = Bitmap.createBitmap(right - left, bottom - top, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    for (subject in kept) {
      canvas.drawBitmap(subject.bitmap!!, (subject.startX - left).toFloat(), (subject.startY - top).toFloat(), null)
    }

    val directory = appContext.cacheDirectory
    val file = File(directory, "lift-${UUID.randomUUID()}.png")
    FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.PNG, 100, it) }

    val coverage = kept.sumOf { maskArea(it) }.toDouble() / (imageWidth.toDouble() * imageHeight.toDouble())
    return mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "width" to output.width,
      "height" to output.height,
      "coverage" to coverage,
      "instances" to kept.size,
    )
  }

  /** Pixels with confidence above 0.5 inside the subject's bounding box. */
  private fun maskArea(subject: Subject): Int {
    val mask = subject.confidenceMask ?: return subject.width * subject.height
    mask.rewind()
    var count = 0
    while (mask.hasRemaining()) {
      if (mask.get() > 0.5f) count++
    }
    return count
  }
}

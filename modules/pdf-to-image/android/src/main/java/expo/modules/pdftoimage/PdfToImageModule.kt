package expo.modules.pdftoimage

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.URI

class PdfToImageModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("PdfToImage")

        AsyncFunction("convert") { fileUri: String, quality: Int ->
            val uri = URI(fileUri)
            val inputFile = File(uri.path)

            if (!inputFile.exists()) {
                throw Exception("File not found: $fileUri")
            }

            val parcelFd = ParcelFileDescriptor.open(inputFile, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = PdfRenderer(parcelFd)
            val results = mutableListOf<Map<String, Any>>()
            val cacheDir = appContext.reactContext?.cacheDir
                ?: throw Exception("Cache directory not available")

            for (i in 0 until renderer.pageCount) {
                val page = renderer.openPage(i)

                val scale = 4.0f
                val width = (page.width * scale).toInt()
                val height = (page.height * scale).toInt()

                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                page.close()

                val outputFile = File(cacheDir, "pdf_page_${System.currentTimeMillis()}_$i.png")
                FileOutputStream(outputFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
                bitmap.recycle()

                results.add(mapOf(
                    "uri" to "file://${outputFile.absolutePath}",
                    "width" to width,
                    "height" to height,
                    "page" to i
                ))
            }

            renderer.close()
            parcelFd.close()

            return@AsyncFunction results
        }
    }
}

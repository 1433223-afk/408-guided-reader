package com.guidedreader.tablet;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Point;
import android.graphics.Rect;
import android.graphics.pdf.PdfRenderer;
import android.os.Looper;
import android.os.ParcelFileDescriptor;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/** Native PDF/OCR boundary; all Reader semantics and persistence stay in Core. */
public final class ReaderDocumentBridge {
    private static final String PROFILE = "mlkit-chinese-16.0.1:bundled:android:v1";
    private static final Semaphore RENDER_SLOTS = new Semaphore(2, true);
    private static final Semaphore OCR_SLOT = new Semaphore(1, true);
    private static volatile Context context;
    private static TextRecognizer recognizer;

    private ReaderDocumentBridge() {}

    public static synchronized void initialize(Context app) {
        if (app == null) throw new IllegalArgumentException("缺少应用存储环境。");
        context = app.getApplicationContext();
    }

    public static String renderPage(String path, int index, int width, String outputPath)
            throws Exception {
        requireBackground();
        if (width < 128 || width > ReaderDocumentGeometry.MAX_SIDE) {
            throw new IllegalArgumentException("页图宽度必须为 128–8192 的整数。");
        }
        File source = sourceFile(path);
        File output = outputFile(outputPath, source);
        Raster raster = render(source, index, width, 0, null);
        try {
            writePng(raster.bitmap, output);
            return raster.description().toString();
        } finally {
            raster.bitmap.recycle();
        }
    }

    public static String extractPage(String path, int index, int dpi) throws Exception {
        requireBackground();
        if (dpi < 72 || dpi > 300) {
            throw new IllegalArgumentException("OCR_DPI_INVALID: 识别分辨率必须为 72–300。");
        }
        File source = sourceFile(path);
        if (!OCR_SLOT.tryAcquire(90, TimeUnit.SECONDS)) {
            throw new IllegalStateException("OCR_BUSY: 本机文字识别仍在处理上一页，请稍后重试。");
        }
        Raster raster = null;
        boolean ownsBitmapAndSlot = true;
        try {
            raster = render(source, index, 0, dpi, null);
            JSONObject result = new JSONObject().put("route", "OCR")
                    .put("engine_profile", PROFILE).put("visible", raster.visible);
            if (!raster.visible) return result.put("lines", new JSONArray()).toString();

            // PdfRenderer/Page have already closed here. OCR never holds their lock.
            Task<Text> task = getRecognizer().process(InputImage.fromBitmap(raster.bitmap, 0));
            Text text;
            try {
                text = Tasks.await(task, 90, TimeUnit.SECONDS);
            } catch (Exception error) {
                if (!task.isComplete()) {
                    final Bitmap inUse = raster.bitmap;
                    // A timed-out Task cannot be cancelled safely: ML Kit may still
                    // be reading this Bitmap. Retain both its pixels and the slot.
                    task.addOnCompleteListener(Runnable::run, ignored -> {
                        inUse.recycle();
                        OCR_SLOT.release();
                    });
                    ownsBitmapAndSlot = false;
                }
                throw new IllegalStateException("OCR_FAILED: 本页文字识别未完成，请稍后重试。", error);
            }
            JSONArray lines = translate(text, raster.bitmap.getWidth(), raster.bitmap.getHeight());
            if (lines.length() == 0) {
                throw new IllegalStateException("OCR_EMPTY_ON_NONBLANK_PAGE: 本页有内容，但未识别到可选择的文字。");
            }
            return result.put("lines", lines).toString();
        } finally {
            if (ownsBitmapAndSlot) {
                if (raster != null) raster.bitmap.recycle();
                OCR_SLOT.release();
            }
        }
    }

    public static String cropPage(String path, int index, String rectJSON, int maxWidth,
            String outputPath) throws Exception {
        requireBackground();
        JSONArray input = new JSONArray(rectJSON);
        if (input.length() != 4) throw new IllegalArgumentException("请框选一个有效的教材区域。");
        double[] rect = new double[4];
        for (int i = 0; i < 4; i++) {
            Object value = input.get(i);
            if (!(value instanceof Number)) throw new IllegalArgumentException("教材选区坐标无效。");
            rect[i] = ((Number) value).doubleValue();
        }
        ReaderDocumentGeometry.validateRect(rect);
        File source = sourceFile(path);
        File output = outputFile(outputPath, source);
        Raster raster = render(source, index, maxWidth, 0, rect);
        try {
            writePng(raster.bitmap, output);
            return raster.description().toString();
        } finally {
            raster.bitmap.recycle();
        }
    }

    private static synchronized TextRecognizer getRecognizer() {
        if (recognizer == null) {
            recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        }
        return recognizer;
    }

    private static Raster render(File source, int index, int width, int dpi, double[] rect)
            throws Exception {
        if (index < 0) throw new IllegalArgumentException("PDF 页码无效。");
        if (!RENDER_SLOTS.tryAcquire(45, TimeUnit.SECONDS)) {
            throw new IllegalStateException("PAGE_RENDER_BUSY: 正在显示其他页面，请稍后重试。");
        }
        Bitmap bitmap = null;
        try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY);
                PdfRenderer document = new PdfRenderer(descriptor)) {
            if (index >= document.getPageCount()) throw new IllegalArgumentException("PDF 页码无效。");
            try (PdfRenderer.Page page = document.openPage(index)) {
                int pdfWidth = page.getWidth();
                int pdfHeight = page.getHeight();
                int[] size;
                Matrix matrix = new Matrix();
                if (rect == null) {
                    if (dpi != 0) {
                        double requested = Math.ceil((double) pdfWidth * dpi / 72.0);
                        if (requested > ReaderDocumentGeometry.MAX_SIDE) {
                            throw new IllegalArgumentException("PDF_PAGE_RESOURCE_LIMIT: 本页超过安全识别范围。");
                        }
                        width = (int) requested;
                    }
                    size = ReaderDocumentGeometry.pageSize(pdfWidth, pdfHeight, width);
                    float scale = (float) width / pdfWidth;
                    matrix.setScale(scale, scale);
                } else {
                    size = ReaderDocumentGeometry.regionSize(pdfWidth, pdfHeight, rect, width);
                    float scale = Math.min((float) (size[0] / (pdfWidth * (rect[2] - rect[0]))),
                            (float) (size[1] / (pdfHeight * (rect[3] - rect[1]))));
                    matrix.setScale(scale, scale);
                    matrix.postTranslate((float) (-rect[0] * pdfWidth * scale),
                            (float) (-rect[1] * pdfHeight * scale));
                }
                bitmap = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
                bitmap.eraseColor(Color.WHITE);
                page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                Raster result = new Raster(bitmap, pdfWidth, pdfHeight, visible(bitmap));
                bitmap = null;
                return result;
            }
        } finally {
            if (bitmap != null) bitmap.recycle();
            RENDER_SLOTS.release();
        }
    }

    private static boolean visible(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int stride = Math.max(1, Math.max(width, height) / 300);
        int[] row = new int[width];
        int dark = 0;
        int count = 0;
        for (int y = 0; y < height; y += stride) {
            bitmap.getPixels(row, 0, width, 0, y, width, 1);
            for (int x = 0; x < width; x += stride) {
                int color = row[x];
                if (Math.min(Color.red(color), Math.min(Color.green(color), Color.blue(color))) < 220) dark++;
                count++;
            }
        }
        return dark >= Math.max(1, count * 0.003);
    }

    private static JSONArray translate(Text result, int width, int height) throws JSONException {
        JSONArray lines = new JSONArray();
        for (Text.TextBlock block : result.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String text = line.getText();
                if (text.trim().isEmpty()) continue;
                JSONArray quad = normalizedQuad(line.getCornerPoints(), line.getBoundingBox(), width, height);
                if (quad == null) continue;
                JSONArray cells = new JSONArray();
                int cursor = 0;
                for (Text.Element element : line.getElements()) {
                    String elementText = element.getText();
                    if (elementText.isEmpty()) continue;
                    int start = text.indexOf(elementText, cursor);
                    if (start < 0) continue;
                    int end = start + elementText.length();
                    JSONArray symbolCells = new JSONArray();
                    int symbolCursor = 0;
                    boolean complete = true;
                    for (Text.Symbol symbol : element.getSymbols()) {
                        String symbolText = symbol.getText();
                        if (symbolText.isEmpty()) continue;
                        int position = elementText.indexOf(symbolText, symbolCursor);
                        if (position < 0 || !appendCell(symbolCells, symbol.getBoundingBox(), text,
                                start + position, start + position + symbolText.length(), width)) {
                            complete = false;
                            break;
                        }
                        if (!elementText.substring(symbolCursor, position).trim().isEmpty()) complete = false;
                        symbolCursor = position + symbolText.length();
                    }
                    if (!elementText.substring(symbolCursor).trim().isEmpty()) complete = false;
                    if (complete && symbolCells.length() > 0) {
                        for (int i = 0; i < symbolCells.length(); i++) cells.put(symbolCells.get(i));
                    } else {
                        // A word-sized real box is safer than invented character boxes.
                        appendCell(cells, element.getBoundingBox(), text, start, end, width);
                    }
                    cursor = end;
                }
                if (cells.length() == 0) appendCell(cells, line.getBoundingBox(), text, 0, text.length(), width);
                if (cells.length() == 0) continue;
                float confidence = line.getConfidence();
                lines.put(new JSONObject().put("quad", quad).put("text", text)
                        .put("confidence", Float.isFinite(confidence) ? clamp(confidence) : 0)
                        .put("cells", cells));
            }
        }
        return lines;
    }

    private static boolean appendCell(JSONArray cells, Rect box, String text,
            int start, int end, int width) throws JSONException {
        if (box == null || box.width() <= 0 || start >= end) return false;
        double x0 = clamp((double) box.left / width);
        double x1 = clamp((double) box.right / width);
        if (x0 >= x1) return false;
        try {
            cells.put(new JSONArray().put(x0).put(x1)
                    .put(ReaderDocumentGeometry.codepointOffset(text, start))
                    .put(ReaderDocumentGeometry.codepointOffset(text, end)));
            return true;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static JSONArray normalizedQuad(Point[] points, Rect fallback, int width, int height)
            throws JSONException {
        if (points == null || points.length != 4) {
            if (fallback == null || fallback.isEmpty()) return null;
            points = new Point[] {new Point(fallback.left, fallback.top), new Point(fallback.right, fallback.top),
                    new Point(fallback.right, fallback.bottom), new Point(fallback.left, fallback.bottom)};
        }
        JSONArray quad = new JSONArray();
        double minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (Point point : points) {
            if (point == null) return null;
            double x = clamp((double) point.x / width), y = clamp((double) point.y / height);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            quad.put(new JSONArray().put(x).put(y));
        }
        return minX < maxX && minY < maxY ? quad : null;
    }

    private static double clamp(double value) { return Math.max(0, Math.min(1, value)); }

    private static File sourceFile(String path) throws IOException {
        File source = privateFile(path);
        if (!source.isFile() || !source.canRead()) throw new IOException("原 PDF 不可读取。");
        return source;
    }

    private static File outputFile(String path, File source) throws IOException {
        File output = privateFile(path);
        if (output.equals(source) || !output.getName().endsWith(".png")) {
            throw new IllegalArgumentException("页图输出路径无效。");
        }
        File parent = output.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            throw new IOException("无法创建本机页图缓存。");
        }
        // Check again after mkdirs, before writing through any path component.
        return privateFile(output.getPath());
    }

    private static File privateFile(String path) throws IOException {
        Context app = context;
        if (app == null) throw new IllegalStateException("本机文档引擎尚未初始化。");
        if (path == null || path.isEmpty()) throw new IllegalArgumentException("文档路径无效。");
        File file = new File(path).getCanonicalFile();
        File files = app.getFilesDir().getCanonicalFile();
        File cache = app.getCacheDir().getCanonicalFile();
        if (!inside(file, files) && !inside(file, cache)) {
            throw new SecurityException("文档只能从本应用的本地书库读取。");
        }
        return file;
    }

    private static boolean inside(File file, File directory) {
        return file.getPath().startsWith(directory.getPath() + File.separator);
    }

    private static void writePng(Bitmap bitmap, File output) throws IOException {
        File temporary = new File(output.getParentFile(), ".page-" + UUID.randomUUID() + ".tmp");
        try {
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    throw new IOException("无法保存本机页图。");
                }
                stream.flush();
                stream.getFD().sync();
            }
            Files.move(temporary.toPath(), output.toPath(), StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } finally {
            if (temporary.exists()) temporary.delete();
        }
    }

    private static void requireBackground() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("文档处理必须在后台运行。");
        }
    }

    private static final class Raster {
        final Bitmap bitmap;
        final int pdfWidth;
        final int pdfHeight;
        final boolean visible;
        Raster(Bitmap bitmap, int pdfWidth, int pdfHeight, boolean visible) {
            this.bitmap = bitmap; this.pdfWidth = pdfWidth; this.pdfHeight = pdfHeight; this.visible = visible;
        }
        JSONObject description() throws JSONException {
            return new JSONObject().put("pdf_width", pdfWidth).put("pdf_height", pdfHeight)
                    .put("width", bitmap.getWidth()).put("height", bitmap.getHeight()).put("visible", visible);
        }
    }
}

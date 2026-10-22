package com.guidedreader.tablet;

/** Allocation limits and text offsets shared by the native document adapter. */
final class ReaderDocumentGeometry {
    static final int MAX_SIDE = 8192;
    static final long MAX_PIXELS = 16_000_000L;
    static final int MAX_REGION_SIDE = 2048;
    static final long MAX_REGION_PIXELS = 3_000_000L;

    private ReaderDocumentGeometry() {}

    static int[] pageSize(int pdfWidth, int pdfHeight, int width) {
        if (pdfWidth <= 0 || pdfHeight <= 0 || width < 16 || width > MAX_SIDE) {
            throw new IllegalArgumentException("PDF_PAGE_RESOURCE_LIMIT: 页面尺寸无效或超过安全范围。");
        }
        double height = Math.ceil((double) pdfHeight * width / pdfWidth);
        if (!Double.isFinite(height) || height < 1 || height > MAX_SIDE
                || width * height > MAX_PIXELS) {
            throw new IllegalArgumentException("PDF_PAGE_RESOURCE_LIMIT: 页面尺寸超过安全渲染范围。");
        }
        return new int[] {width, (int) height};
    }

    static void validateRect(double[] rect) {
        if (rect == null || rect.length != 4) {
            throw new IllegalArgumentException("请框选一个有效的教材区域。");
        }
        for (double value : rect) {
            if (!Double.isFinite(value) || value < 0 || value > 1) {
                throw new IllegalArgumentException("教材选区必须完整位于当前 PDF 页面内。");
            }
        }
        if (rect[0] >= rect[2] || rect[1] >= rect[3]) {
            throw new IllegalArgumentException("请框选一个有效的教材区域。");
        }
    }

    static int[] regionSize(int pdfWidth, int pdfHeight, double[] rect, int maxWidth) {
        validateRect(rect);
        if (pdfWidth <= 0 || pdfHeight <= 0 || maxWidth < 16 || maxWidth > MAX_REGION_SIDE) {
            throw new IllegalArgumentException("教材选区图像尺寸无效。");
        }
        double width = pdfWidth * (rect[2] - rect[0]);
        double height = pdfHeight * (rect[3] - rect[1]);
        double scale = Math.min(3.0, Math.min(maxWidth / width,
                Math.min((MAX_REGION_SIDE - 1.0) / Math.max(width, height),
                        Math.sqrt((MAX_REGION_PIXELS - 2.0 * MAX_REGION_SIDE) / (width * height)))));
        int outputWidth = (int) Math.ceil(width * scale);
        int outputHeight = (int) Math.ceil(height * scale);
        if (Math.min(outputWidth, outputHeight) < 16) {
            throw new IllegalArgumentException("选区太小，请把需要解释的公式或图表完整框入。");
        }
        if (Math.max(outputWidth, outputHeight) > MAX_REGION_SIDE
                || (long) outputWidth * outputHeight > MAX_REGION_PIXELS) {
            throw new IllegalArgumentException("教材选区图像超过安全范围。");
        }
        return new int[] {outputWidth, outputHeight};
    }

    static int codepointOffset(String text, int utf16Offset) {
        if (text == null || utf16Offset < 0 || utf16Offset > text.length()
                || (utf16Offset > 0 && utf16Offset < text.length()
                    && Character.isLowSurrogate(text.charAt(utf16Offset))
                    && Character.isHighSurrogate(text.charAt(utf16Offset - 1)))) {
            throw new IllegalArgumentException("文字偏移不能截断 Unicode 字符。");
        }
        return text.codePointCount(0, utf16Offset);
    }
}

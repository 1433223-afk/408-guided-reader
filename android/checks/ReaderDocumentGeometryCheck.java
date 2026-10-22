package com.guidedreader.tablet;

import java.util.Arrays;

/** Host-JDK checks; no Android device, network or user library is needed. */
public final class ReaderDocumentGeometryCheck {
    public static void main(String[] args) {
        same(ReaderDocumentGeometry.pageSize(612, 792, 1200), 1200, 1553);
        same(ReaderDocumentGeometry.pageSize(792, 612, 1200), 1200, 928);
        fails(() -> ReaderDocumentGeometry.pageSize(1, 100, 8192));
        fails(() -> ReaderDocumentGeometry.pageSize(1000, 1000, 5000));
        fails(() -> ReaderDocumentGeometry.pageSize(612, 792, 0));
        double[] region = {0.1, 0.2, 0.9, 0.8};
        int[] crop = ReaderDocumentGeometry.regionSize(612, 792, region, 1800);
        if (crop[0] > 1800 || crop[1] > 2048 || (long) crop[0] * crop[1] > 3_000_000) {
            throw new AssertionError("Crop exceeded budget: " + Arrays.toString(crop));
        }
        fails(() -> ReaderDocumentGeometry.regionSize(612, 792, new double[] {0, 0, 0.0001, 1}, 1800));
        fails(() -> ReaderDocumentGeometry.validateRect(new double[] {0, 0, Double.NaN, 1}));
        fails(() -> ReaderDocumentGeometry.validateRect(new double[] {0.8, 0, 0.2, 1}));
        fails(() -> ReaderDocumentGeometry.validateRect(new double[] {-0.1, 0, 1, 1}));
        String unicode = "中\uD83D\uDE00文 a";
        if (ReaderDocumentGeometry.codepointOffset(unicode, 3) != 2
                || ReaderDocumentGeometry.codepointOffset(unicode, unicode.length()) != 5) {
            throw new AssertionError("UTF-16 offsets did not map to Python codepoints");
        }
        fails(() -> ReaderDocumentGeometry.codepointOffset(unicode, 2));
        System.out.println("ReaderDocumentGeometry checks passed");
    }

    private static void same(int[] actual, int width, int height) {
        if (actual[0] != width || actual[1] != height) throw new AssertionError(Arrays.toString(actual));
    }

    private static void fails(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid geometry to be rejected");
    }
}

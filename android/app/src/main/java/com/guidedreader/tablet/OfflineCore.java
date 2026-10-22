package com.guidedreader.tablet;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** One process-local Core, independent of Activity recreation and network access. */
public final class OfflineCore {
    public static final int PORT = 18765;
    public static final String ORIGIN = "http://127.0.0.1:" + PORT;
    private static final long MAX_ASSET_BYTES = 768L * 1024 * 1024;
    private static final int MAX_ASSET_ENTRIES = 50000;
    private static final ExecutorService STARTER = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final List<Callback> callbacks = new ArrayList<>();
    private static String launchUrl;
    private static boolean starting;

    public interface Callback {
        void onReady(String url);
        void onFailure(String safeMessage);
    }

    public interface AvailabilityCallback {
        void onResult(boolean empty);
        void onFailure(String safeMessage);
    }

    public interface RestoreCallback {
        void onRestored(String url, int books, int pages);
        void onFailure(String safeMessage, String recoveredUrl);
    }

    private OfflineCore() {}

    public static synchronized void ensureStarted(Context context, Callback callback) {
        if (launchUrl != null) {
            String current = launchUrl;
            MAIN.post(() -> callback.onReady(current));
            return;
        }
        callbacks.add(callback);
        if (starting) return;
        starting = true;
        Context app = context.getApplicationContext();
        STARTER.execute(() -> {
            String result = null;
            String failure = null;
            try {
                NativeCredentialStore.initialize(app);
                ReaderDocumentBridge.initialize(app);
                File web = unpackAssets(app);
                File data = new File(app.getFilesDir(), "reader-local");
                if (!data.isDirectory() && !data.mkdirs()) throw new IOException("Cannot prepare Reader storage");
                if (!Python.isStarted()) Python.start(new AndroidPlatform(app));
                result = Python.getInstance().getModule("android_reader")
                        .callAttr("start", data.getAbsolutePath(), web.getAbsolutePath(), PORT).toString();
                if (!isLocalUrl(result)) throw new IOException("Invalid local Reader entry");
            } catch (Exception failureCause) {
                logFailure(app, "Local Reader startup failed", failureCause);
                // Python exceptions may contain paths or request secrets. Keep the
                // user-facing startup error fixed and never print the exception.
                failure = "本机 Reader 未能启动。请检查平板剩余存储后重试；已导入的教材不会被清除。";
            }
            finish(result, failure);
        });
    }

    public static void canRestore(Context context, AvailabilityCallback callback) {
        Context app = context.getApplicationContext();
        STARTER.execute(() -> {
            boolean empty;
            try {
                empty = Python.getInstance().getModule("android_reader")
                        .callAttr("can_restore", new File(app.getFilesDir(), "reader-local").getAbsolutePath()).toBoolean();
            } catch (Exception failure) {
                logFailure(app, "Library import availability check failed", failure);
                MAIN.post(() -> callback.onFailure("暂时无法检查本机书库，请稍后重试。"));
                return;
            }
            MAIN.post(() -> callback.onResult(empty));
        });
    }

    /** The caller must stop WebView loading first; only this worker runs stop/restore/start. */
    public static synchronized void restoreLibrary(Context context, File archive, RestoreCallback callback) {
        if (starting) {
            archive.delete();
            MAIN.post(() -> callback.onFailure("本机 Reader 正在准备中，请稍后重试。", null));
            return;
        }
        starting = true;
        launchUrl = null;
        Context app = context.getApplicationContext();
        STARTER.execute(() -> {
            String restoredEntry = null;
            String restoreError = null;
            int books = 0, pages = 0;
            boolean restored = false;
            try {
                Python python = Python.getInstance();
                python.getModule("android_reader").callAttr("stop");
                JSONObject result = new JSONObject(python.getModule("android_reader")
                        .callAttr("restore_library_result", new File(app.getFilesDir(), "reader-local").getAbsolutePath(),
                                archive.getAbsolutePath()).toString());
                restored = result.optBoolean("restored", false);
                if (restored) {
                    books = result.getInt("books"); pages = result.getInt("pages");
                } else {
                    restoreError = result.optString("error", "书库未能导入，原有数据已保留。");
                    if (!safeRestoreMessage(restoreError)) restoreError = "书库未能导入，原有数据已保留。";
                }
            } catch (Exception failure) {
                logFailure(app, "Local library restore failed", failure);
                restoreError = "书库未能导入，原有数据已保留。请检查迁移文件后重试。";
            } finally {
                try {
                    restoredEntry = Python.getInstance().getModule("android_reader").callAttr("start",
                            new File(app.getFilesDir(), "reader-local").getAbsolutePath(),
                            new File(app.getFilesDir(), "reader-web").getAbsolutePath(), PORT).toString();
                    if (!isLocalUrl(restoredEntry)) throw new IOException("Invalid restored Reader entry");
                } catch (Exception failure) {
                    logFailure(app, "Reader restart after library import failed", failure);
                    restoredEntry = null;
                    restoreError = restored
                            ? "书库已经导入，但阅读页面暂未能重新打开。请从应用菜单重试；教材仍保留。"
                            : "书库未能导入，原有数据已保留。请重新打开本机 Reader 后重试。";
                }
                archive.delete();
            }
            String entry = restoredEntry, message = restoreError;
            int bookCount = books, pageCount = pages;
            boolean completed = restored && restoreError == null;
            finish(entry, entry == null ? message : null);
            MAIN.post(() -> {
                if (completed) callback.onRestored(entry, bookCount, pageCount);
                else callback.onFailure(message, entry);
            });
        });
    }

    private static boolean safeRestoreMessage(String value) {
        return value != null && !value.isEmpty() && value.length() <= 300
                && value.indexOf('\n') < 0 && value.indexOf('\r') < 0
                && value.indexOf('/') < 0 && value.indexOf('\\') < 0 && value.indexOf('@') < 0;
    }

    private static void logFailure(Context context, String stage, Exception failure) {
        if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Log.e("ReaderLocalCore", stage, failure);
        }
    }

    private static void finish(String result, String failure) {
        List<Callback> listeners;
        synchronized (OfflineCore.class) {
            starting = false;
            if (failure == null) launchUrl = result;
            listeners = new ArrayList<>(callbacks);
            callbacks.clear();
        }
        MAIN.post(() -> {
            for (Callback listener : listeners) {
                if (failure == null) listener.onReady(result);
                else listener.onFailure(failure);
            }
        });
    }

    public static boolean isLocalUrl(String value) {
        if (value == null || value.length() > 16384 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) return false;
        try {
            URI uri = new URI(value);
            return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost())
                    && uri.getPort() == PORT && uri.getRawUserInfo() == null && uri.getRawFragment() == null;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static boolean isProbe(String value) {
        if (!isLocalUrl(value)) return false;
        try { return "/tablet-pen-check.html".equals(new URI(value).getPath()); }
        catch (Exception ignored) { return false; }
    }

    private static File unpackAssets(Context context) throws Exception {
        File files = context.getFilesDir();
        File web = new File(files, "reader-web");
        File stage = new File(files, "reader-web-stage");
        File previous = new File(files, "reader-web-old");
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        long versionCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        String version = versionCode + ":" + info.lastUpdateTime;
        File marker = new File(web, ".asset-version");
        if (marker.isFile() && version.equals(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8))) return web;
        removeAssetDirectory(files, stage);
        removeAssetDirectory(files, previous);
        if (!stage.mkdirs()) throw new IOException("Cannot prepare bundled Reader assets");
        String prefix = stage.getCanonicalPath() + File.separator;
        long total = 0;
        int count = 0;
        try (InputStream bundled = context.getAssets().open("reader-web.zip");
             ZipInputStream zip = new ZipInputStream(bundled)) {
            ZipEntry entry;
            byte[] buffer = new byte[64 * 1024];
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (++count > MAX_ASSET_ENTRIES || name.isEmpty() || name.indexOf('\\') >= 0 || name.startsWith("/")) {
                    throw new IOException("Invalid bundled asset entry");
                }
                File target = new File(stage, name);
                if (!target.getCanonicalPath().startsWith(prefix)) throw new IOException("Bundled asset escaped destination");
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create bundled directory");
                } else {
                    File parent = target.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create bundled directory");
                    try (FileOutputStream output = new FileOutputStream(target)) {
                        int size;
                        while ((size = zip.read(buffer)) != -1) {
                            total += size;
                            if (total > MAX_ASSET_BYTES) throw new IOException("Bundled assets exceed limit");
                            output.write(buffer, 0, size);
                        }
                    }
                }
                zip.closeEntry();
            }
        } catch (Exception failure) {
            removeAssetDirectory(files, stage);
            throw failure;
        }
        if (!new File(stage, "static/index.html").isFile()
                && !new File(stage, "src/reader_service/static/index.html").isFile()
                && !new File(stage, "index.html").isFile()) {
            removeAssetDirectory(files, stage);
            throw new IOException("Bundled Reader entry missing");
        }
        Files.write(new File(stage, ".asset-version").toPath(), version.getBytes(StandardCharsets.UTF_8));
        if (web.exists() && !web.renameTo(previous)) throw new IOException("Cannot replace bundled Reader assets");
        if (!stage.renameTo(web)) {
            if (previous.exists()) previous.renameTo(web);
            throw new IOException("Cannot activate bundled Reader assets");
        }
        removeAssetDirectory(files, previous);
        return web;
    }

    private static void removeAssetDirectory(File files, File directory) throws IOException {
        String canonical = directory.getCanonicalPath();
        String base = files.getCanonicalPath() + File.separator;
        if (!canonical.equals(base + "reader-web-stage") && !canonical.equals(base + "reader-web-old")) {
            throw new IOException("Unsafe asset cleanup destination");
        }
        deleteInside(directory, canonical);
    }

    private static void deleteInside(File item, String allowed) throws IOException {
        if (!item.exists()) return;
        String target = item.getCanonicalPath();
        if (!target.equals(allowed) && !target.startsWith(allowed + File.separator)) throw new IOException("Unsafe asset cleanup path");
        if (item.isDirectory()) {
            File[] children = item.listFiles();
            if (children == null) throw new IOException("Cannot inspect bundled assets");
            for (File child : children) deleteInside(child, allowed);
        }
        if (!item.delete()) throw new IOException("Cannot remove obsolete bundled asset");
    }
}

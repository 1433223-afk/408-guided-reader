package com.guidedreader.tablet;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** The shared Reader and Python Core run locally; the network is used only by AI. */
public final class MainActivity extends Activity {
    private static final int PICK_PDF = 1001;
    private static final int SAVE_REPORT = 1002;
    private static final int PICK_LIBRARY = 1003;
    private static final long MAX_LIBRARY_ARCHIVE_BYTES = 8L * 1024 * 1024 * 1024;
    private static final int MAX_REPORT_BYTES = 256 * 1024;
    private FrameLayout root;
    private WebView webView;
    private View connectionPanel;
    private TextView startupMessage;
    private Button probeSave;
    private boolean coreReady;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingReport;
    private boolean needsReconnect;
    private boolean authPrompted;
    private boolean clearHistoryAfterLoad;
    private long previousBack;
    private String localEntry;
    private boolean libraryBusy;
    private boolean credentialWritePending;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.paper));
        setContentView(root);
        configureInsets();
        createWebView();
        probeSave=button("保存 JSON");probeSave.setVisibility(View.GONE);
        probeSave.setOnClickListener(view->exportProbe());
        FrameLayout.LayoutParams reportButton=new FrameLayout.LayoutParams(-2,dp(48),Gravity.BOTTOM|Gravity.END);
        reportButton.setMargins(dp(16),dp(16),dp(16),dp(16));root.addView(probeSave,reportButton);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        discardLegacyConnectionIntent(getIntent());
        startLocalReader();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        discardLegacyConnectionIntent(intent);
    }

    private void discardLegacyConnectionIntent(Intent incoming) {
        if (incoming == null || !Intent.ACTION_VIEW.equals(incoming.getAction())) return;
        // Older APK links contain computer credentials. The local edition does
        // not consume or retain them and never navigates away from loopback.
        incoming.setData(null); incoming.replaceExtras((Bundle) null); incoming.setClipData(null);
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER));
        toast("此版本在平板本机阅读，无需连接电脑。");
    }

    private void startLocalReader() {
        showStartup("正在打开本机书库…", false);
        OfflineCore.ensureStarted(this, new OfflineCore.Callback() {
            @Override public void onReady(String url) {
                if (isFinishing() || isDestroyed()) return;
                openLocalEntry(url);
            }
            @Override public void onFailure(String message) {
                if (!isFinishing() && !isDestroyed()) showStartup(message, true);
            }
        });
    }

    private void openLocalEntry(String url) {
        localEntry = url;
        coreReady = true;
        needsReconnect = authPrompted = false;
        clearHistoryAfterLoad = true;
        hideConnection();
        webView.loadUrl(url);
    }

    private void configureInsets() {
        getWindow().setStatusBarColor(getColor(R.color.paper));
        getWindow().setNavigationBarColor(getColor(R.color.paper));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                // Insets and View padding both use physical pixels. Do not
                // multiply by density again; Android maps the remaining area
                // to the WebView's CSS viewport. Only one owner applies IME.
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) controller.setSystemBarsAppearance(
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                return WindowInsets.CONSUMED;
            });
            root.requestApplyInsets();
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setSaveEnabled(false); // Never serialize a token-bearing launch history into the Activity Bundle.
        webView.setBackgroundColor(getColor(R.color.paper));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // IndexedDB is provided by the system WebView for this origin.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // User-selected SAF content URIs, required by the PDF file input.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // Keep the system UA and all pen/touch dispatch untouched. The tablet=1
        // entry chooses Reader's existing layout and JavaScript pinch handling.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView.setWebViewClient(new ReaderClient());
        webView.setWebChromeClient(new ReaderChrome());
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (OfflineCore.isProbe(webView.getUrl())) exportProbe();
            else toast("此版本只支持保存触控笔测试 JSON；其他下载请使用浏览器。");
        });
        root.addView(webView, 0, new FrameLayout.LayoutParams(-1, -1));
    }

    private final class ReaderClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return blockNavigation(request.getUrl().toString());
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return blockNavigation(url); }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String target = request.getUrl().toString();
            if (OfflineCore.isLocalUrl(target)) return null;
            String scheme = request.getUrl().getScheme();
            if ("data".equals(scheme) || "about".equals(scheme)) return null;
            if ("blob".equals(scheme) && target.startsWith("blob:" + OfflineCore.ORIGIN + "/")) return null;
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null,
                    new ByteArrayInputStream("仅允许当前 Reader 的同源资源。".getBytes(StandardCharsets.UTF_8)));
        }

        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if(probeSave!=null) probeSave.setVisibility(View.GONE);
            if (!"about:blank".equals(url) && !OfflineCore.isLocalUrl(url)) {
                view.stopLoading(); toast("已阻止离开本机 Reader。");
            }
        }

        @Override public void onPageFinished(WebView view, String url) {
            if(probeSave!=null) probeSave.setVisibility(connectionPanel==null&&OfflineCore.isProbe(url)?View.VISIBLE:View.GONE);
            if (OfflineCore.isLocalUrl(url) && clearHistoryAfterLoad) {
                clearHistoryAfterLoad = false; view.clearHistory();
            }
            CookieManager.getInstance().flush();
        }

        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (response.getStatusCode() == 401 && OfflineCore.isLocalUrl(request.getUrl().toString())) {
                needsReconnect = true;
                if (!authPrompted) {
                    authPrompted = true;
                    runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                            .setTitle("重新打开本机 Reader")
                            .setMessage("本机阅读会话需要重新打开。已保存的教材和学习内容仍保留。")
                            .setPositiveButton("重新打开", (dialog, which) -> startLocalReader())
                            .setNegativeButton("保留当前页面", null).show());
                }
            }
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showStartup("本机阅读页面未能打开（" + error.getErrorCode() + "）。请重试；无需连接电脑。", true);
                needsReconnect = true;
            }
        }

        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); needsReconnect = true;
            toast("已停止无法验证的外部连接。教材可继续在本机阅读。");
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            cancelFileChooser();
            root.removeView(view); view.destroy(); createWebView();
            showStartup("系统阅读内核已退出。已保存的教材和笔迹仍保留，请重新打开。", true);
            return true;
        }
    }

    private boolean blockNavigation(String url) {
        if (OfflineCore.isLocalUrl(url)) return false;
        toast("只允许本机 Reader；笔测试页面可以正常打开。");
        return true;
    }

    private final class ReaderChrome extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
            cancelFileChooser(); fileCallback = callback;
            if (!coreReady || !OfflineCore.isLocalUrl(view.getUrl())) { cancelFileChooser(); return true; }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, parameters.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try { startActivityForResult(intent, PICK_PDF); }
            catch (ActivityNotFoundException | SecurityException ignored) {
                cancelFileChooser(); toast("系统文件选择器无法打开，请检查设备的文件应用。");
            }
            return true;
        }

        @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message message) {
            if (!userGesture || !coreReady) return false;
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                private boolean forwarded;
                private void forward(String url) {
                    if (!"about:blank".equals(url)&&!forwarded) {
                        forwarded=true;
                        if (!blockNavigation(url)) webView.loadUrl(url);
                        popup.stopLoading(); popup.post(popup::destroy);
                    }
                }
                @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                    forward(request.getUrl().toString()); return true;
                }
                @Override public void onPageStarted(WebView child, String url, android.graphics.Bitmap favicon) { forward(url); }
                @Override public WebResourceResponse shouldInterceptRequest(WebView child,WebResourceRequest request) {
                    if(request.isForMainFrame()) popup.post(()->forward(request.getUrl().toString()));
                    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                }
            });
            ((WebView.WebViewTransport) message.obj).setWebView(popup);
            message.sendToTarget();
            return true;
        }
    }

    private void showStartup(String explanation, boolean failed) {
        if (connectionPanel != null) root.removeView(connectionPanel);
        if(probeSave!=null)probeSave.setVisibility(View.GONE);
        notifyPageBlur(); webView.setVisibility(View.INVISIBLE);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setBackgroundColor(getColor(R.color.paper));
        LinearLayout column = new ReaderColumn();
        column.setOrientation(LinearLayout.VERTICAL); column.setGravity(Gravity.CENTER_VERTICAL);
        column.setPadding(dp(32), dp(28), dp(32), dp(28));
        TextView title = text("Guided Reader", 26, R.color.ink); column.addView(title);
        startupMessage = text(explanation, 16, R.color.muted);
        startupMessage.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        column.addView(startupMessage, spaced(0,18));
        if (failed) {
            Button retry = button("重新打开");
            retry.setOnClickListener(view -> startLocalReader());
            column.addView(retry, spaced(0,18));
            Button settings = button("AI 设置");
            settings.setOnClickListener(view -> showAiSettings());
            column.addView(settings, spaced(0,8));
        }
        FrameLayout centered = new FrameLayout(this);
        centered.addView(column,new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER_HORIZONTAL));
        scroll.addView(centered,new ScrollView.LayoutParams(-1,-1));
        connectionPanel=scroll; root.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
    }

    private final class ReaderColumn extends LinearLayout {
        ReaderColumn() { super(MainActivity.this); }
        @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            int available = View.MeasureSpec.getSize(widthMeasureSpec);
            int width = View.MeasureSpec.getMode(widthMeasureSpec) == View.MeasureSpec.UNSPECIFIED
                    ? dp(600) : Math.min(available, dp(600));
            super.onMeasure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), heightMeasureSpec);
        }
    }

    private void hideConnection() {
        if (connectionPanel != null) {root.removeView(connectionPanel);connectionPanel=null;}
        webView.setVisibility(View.VISIBLE);
        if(probeSave!=null)probeSave.setVisibility(OfflineCore.isProbe(webView.getUrl())?View.VISIBLE:View.GONE);
    }

    private void handleBack() {
        if (connectionPanel != null) {
            readerMenu();
            return;
        }
        if (!coreReady || needsReconnect) {readerMenu();return;}
        if (OfflineCore.isProbe(webView.getUrl())) {
            if (webView.canGoBack()) webView.goBack(); else webView.loadUrl(localEntry);
            return;
        }
        long now=SystemClock.uptimeMillis();
        if (now-previousBack<1500) {previousBack=0;readerMenu();return;}
        previousBack=now;
        // A fixed DOM action reuses Reader's own save-and-close behavior. No
        // gesture is intercepted and no arbitrary native JS bridge is exposed.
        webView.evaluateJavascript("(function(){var r=document.getElementById('reader'),b=document.getElementById('back-to-library');if(r&&!r.hidden&&b){b.click();return 'reader';}return 'library';})()",
                result -> {if (!"\"reader\"".equals(result)) readerMenu();});
    }

    private void readerMenu() {
        if (libraryBusy) {toast("正在导入本机书库，请等待完成。");return;}
        List<String> actions=new ArrayList<>();
        actions.add("继续阅读");
        actions.add("AI 设置");
        if (coreReady) actions.add("导入原有书库");
        if (!coreReady || needsReconnect || connectionPanel != null) actions.add("重新打开本机书库");
        boolean probe=OfflineCore.isProbe(webView.getUrl());
        if(probe) actions.add("保存测试结果 JSON");
        actions.add("退出应用");
        new AlertDialog.Builder(this).setTitle("Guided Reader")
                .setItems(actions.toArray(new String[0]),(dialog,index)->{
                    String action=actions.get(index);
                    if("AI 设置".equals(action)) showAiSettings();
                    else if("导入原有书库".equals(action)) chooseLibraryArchive();
                    else if("重新打开本机书库".equals(action)) startLocalReader();
                    else if("继续阅读".equals(action) && coreReady && !needsReconnect) hideConnection();
                    else if("保存测试结果 JSON".equals(action)) exportProbe();
                    else if("退出应用".equals(action)) new AlertDialog.Builder(this)
                            .setMessage("教材和已保存内容保留在这台平板。退出前请确认笔迹保存完成。")
                            .setPositiveButton("退出",(inner,which)->{notifyPageBlur();finish();})
                            .setNegativeButton("继续阅读",null).show();
                }).show();
    }

    private void chooseLibraryArchive() {
        libraryBusy = true;
        OfflineCore.canRestore(this, new OfflineCore.AvailabilityCallback() {
            @Override public void onResult(boolean empty) {
                libraryBusy = false;
                if (isFinishing() || isDestroyed()) return;
                if (!empty) {
                    new AlertDialog.Builder(MainActivity.this).setTitle("当前书库已有内容")
                            .setMessage("迁移仅适用于空书库。现有教材、笔迹和学习记录会保留，不会被迁移文件覆盖。")
                            .setPositiveButton("知道了", null).show();
                    return;
                }
                new AlertDialog.Builder(MainActivity.this).setTitle("导入原有书库")
                        .setMessage("选择从 Reader 导出的 .grlibrary 迁移文件。导入后，原 PDF 和已保存的学习内容存放在此平板，断网也可阅读。仅允许导入到空书库。")
                        .setPositiveButton("选择迁移文件", (dialog, which) -> {
                            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                                    .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    .putExtra(Intent.EXTRA_TITLE, "选择 .grlibrary 书库迁移文件");
                            try {startActivityForResult(intent, PICK_LIBRARY);}
                            catch (ActivityNotFoundException | SecurityException failure) {toast("系统文件选择器无法打开，请检查文件应用。");}
                        }).setNegativeButton("取消", null).show();
            }
            @Override public void onFailure(String message) {
                libraryBusy = false;
                if (!isFinishing() && !isDestroyed()) toast(message);
            }
        });
    }

    private void importLibraryArchive(Uri source) {
        if (libraryBusy) return;
        if (source == null || !"content".equals(source.getScheme())) {toast("迁移文件位置无效，请重新选择。");return;}
        libraryBusy = true;
        coreReady = false;
        cancelFileChooser(); notifyPageBlur(); webView.stopLoading(); webView.loadUrl("about:blank");
        showStartup("正在读取书库迁移文件…", false);
        new Thread(() -> {
            File archive = null;
            try {
                long expected = -1;
                try (Cursor cursor = getContentResolver().query(source, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) expected = cursor.getLong(0);
                }
                if (expected > MAX_LIBRARY_ARCHIVE_BYTES) throw new IllegalArgumentException("迁移文件超过 8 GiB，请拆分书库后重试。");
                if (expected >= 0 && getCacheDir().getUsableSpace() < expected + 128L * 1024 * 1024) {
                    throw new IllegalArgumentException("平板剩余空间不足，无法读取迁移文件。请释放存储后重试。");
                }
                archive = File.createTempFile("reader-migration-", ".grlibrary", getCacheDir());
                long copied = 0, reported = 0;
                try (InputStream input = getContentResolver().openInputStream(source);
                     FileOutputStream output = new FileOutputStream(archive)) {
                    if (input == null) throw new IllegalStateException();
                    byte[] buffer = new byte[1024 * 1024];
                    int size;
                    while ((size = input.read(buffer)) != -1) {
                        copied += size;
                        if (copied > MAX_LIBRARY_ARCHIVE_BYTES) throw new IllegalArgumentException("迁移文件超过 8 GiB，请拆分书库后重试。");
                        output.write(buffer, 0, size);
                        if (copied - reported >= 4L * 1024 * 1024) {
                            reported = copied;
                            String progress = expected > 0 ? "正在读取迁移文件… " + Math.min(100, copied * 100 / expected) + "%"
                                    : "正在读取迁移文件… " + copied / (1024 * 1024) + " MB";
                            runOnUiThread(() -> {if (libraryBusy && startupMessage != null) startupMessage.setText(progress);});
                        }
                    }
                    output.getFD().sync();
                }
                if (copied == 0 || (expected > 0 && copied != expected)) {
                    throw new IllegalArgumentException("迁移文件没有读取完整，请重新选择内部存储中的文件。");
                }
                File readyArchive = archive;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {readyArchive.delete();return;}
                    if (startupMessage != null) startupMessage.setText("正在暂停阅读并导入书库…");
                    OfflineCore.restoreLibrary(MainActivity.this, readyArchive, new OfflineCore.RestoreCallback() {
                        @Override public void onRestored(String url, int books, int pages) {
                            libraryBusy = false;
                            if (isFinishing() || isDestroyed()) return;
                            openLocalEntry(url); toast("已导入 " + books + " 本教材（" + pages + " 页），可以离线阅读。");
                        }
                        @Override public void onFailure(String message, String recoveredUrl) {
                            libraryBusy = false;
                            if (isFinishing() || isDestroyed()) return;
                            if (recoveredUrl != null) {openLocalEntry(recoveredUrl);toast(message);}
                            else showStartup(message, true);
                        }
                    });
                });
            } catch (Exception failure) {
                if (archive != null) archive.delete();
                String message = failure instanceof IllegalArgumentException ? failure.getMessage()
                        : "迁移文件未能读取，请检查文件权限和剩余空间后重试。原有数据已保留。";
                runOnUiThread(() -> {
                    libraryBusy = false;
                    if (isFinishing() || isDestroyed()) return;
                    startLocalReader(); toast(message);
                });
            }
        }, "reader-library-copy").start();
    }

    private void showAiSettings() {
        NativeCredentialStore.initialize(getApplicationContext());
        notifyPageBlur();
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(12), dp(24), dp(12));
        scroll.addView(form, new ScrollView.LayoutParams(-1, -2));
        form.addView(text("联网时调用 AI；教材和已保存的学习内容可离线阅读。", 15, R.color.ink));
        form.addView(text("API Key 加密保存在这台平板，不会从电脑自动复制。", 13, R.color.muted), spaced(0,8));
        EditText deepseek = addProviderSetting(form, "DeepSeek · deepseek-flash", "deepseek");
        EditText zhipu = addProviderSetting(form, "智谱 · GLM-5.3-Flash", "zhipu");
        TextView result = text("留空保留当前 Key；填写后点保存。", 13, R.color.muted);
        result.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        form.addView(result, spaced(0,12));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("AI 设置")
                .setView(scroll).setPositiveButton("保存", null).setNegativeButton("返回", null).create();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        dialog.setOnDismissListener(ignored -> {
            deepseek.setText(""); zhipu.setText("");
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        dialog.setOnShowListener(ignored -> {
            dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if (credentialWritePending) return;
                String deepseekValue = deepseek.getText().toString().trim();
                String zhipuValue = zhipu.getText().toString().trim();
                if (!validCredentialInput(deepseekValue) || !validCredentialInput(zhipuValue)) {
                    result.setText("API Key 内容无效，请检查是否误带换行或过长文字。");
                    return;
                }
                if (deepseekValue.isEmpty() && zhipuValue.isEmpty()) {
                    dialog.dismiss(); return;
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
                credentialWritePending = true;
                deepseek.setEnabled(false); zhipu.setEnabled(false);
                dialog.setCancelable(false); dialog.setCanceledOnTouchOutside(false);
                result.setText("正在加密保存…");
                new Thread(() -> {
                    boolean saved;
                    try {
                        if (!deepseekValue.isEmpty()) NativeCredentialStore.write("deepseek", deepseekValue);
                        if (!zhipuValue.isEmpty()) NativeCredentialStore.write("zhipu", zhipuValue);
                        saved = true;
                    } catch (Exception ignoredFailure) { saved = false; }
                    boolean completed = saved;
                    runOnUiThread(() -> {
                        credentialWritePending = false;
                        refreshAiSettings();
                        if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                        deepseek.setEnabled(true); zhipu.setEnabled(true);
                        dialog.setCancelable(true); dialog.setCanceledOnTouchOutside(true);
                        if (completed) {
                            dialog.dismiss(); toast("AI 设置已保存；联网后可以提问。");
                        } else {
                            result.setText("保存未完成，请重试。已经保存的 Key 仍保留。");
                        }
                    });
                }, "reader-key-save").start();
            });
        });
        dialog.show();
    }

    private EditText addProviderSetting(LinearLayout form, String label, String provider) {
        boolean configured = NativeCredentialStore.isConfigured(provider);
        form.addView(text(label, 16, R.color.ink), spaced(0,20));
        TextView state = text(configured ? "已配置" : "尚未配置", 13, R.color.muted);
        form.addView(state, spaced(0,3));
        EditText input = new EditText(this);
        input.setTextSize(16);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_NEXT | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        input.setHint(configured ? "新 Key（留空保留）" : "粘贴 API Key");
        input.setSaveEnabled(false); input.setFreezesText(false);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        form.addView(input, spaced(0,6));
        Button remove = button("移除已保存的 Key");
        remove.setEnabled(configured);
        remove.setOnClickListener(view -> {
            if (credentialWritePending) return;
            credentialWritePending = true;
            remove.setEnabled(false);
            new Thread(() -> {
                boolean removed;
                try { NativeCredentialStore.write(provider, null); removed = true; }
                catch (Exception ignored) { removed = false; }
                boolean completed = removed;
                runOnUiThread(() -> {
                    credentialWritePending = false;
                    refreshAiSettings();
                    if (isFinishing() || isDestroyed()) return;
                    if (completed) {
                        input.setText(""); input.setHint("粘贴 API Key"); state.setText("尚未配置");
                    } else {
                        remove.setEnabled(true); toast("未能移除 Key，请重试。");
                    }
                });
            }, "reader-key-remove").start();
        });
        form.addView(remove, spaced(0,2));
        return input;
    }

    private static boolean validCredentialInput(String value) {
        return value.length() <= 8192 && value.indexOf('\n') < 0 && value.indexOf('\r') < 0;
    }

    private void refreshAiSettings() {
        if (!isFinishing() && !isDestroyed() && webView != null && OfflineCore.isLocalUrl(webView.getUrl())) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('reader-native-ai-settings'));", null);
        }
    }

    private void exportProbe() {
        if(!OfflineCore.isProbe(webView.getUrl())) {toast("请先打开触控笔试写页面。");return;}
        if(pendingReport!=null) {toast("请先完成当前的保存窗口。");return;}
        webView.evaluateJavascript("(function(){if(!window.TabletPenCheck)return null;return JSON.stringify(window.TabletPenCheck.getReport());})()",value->{
            try {
                if(!OfflineCore.isProbe(webView.getUrl())||value==null||value.length()>MAX_REPORT_BYTES*2) throw new IllegalArgumentException();
                Object decoded=new JSONTokener(value).nextValue();
                if(!(decoded instanceof String)) throw new IllegalArgumentException();
                JSONObject report=new JSONObject((String)decoded);
                if(report.optInt("schemaVersion")!=1) throw new IllegalArgumentException();
                JSONObject clean=new JSONObject();
                for(String field:new String[]{"schemaVersion","browser","capabilities","durationMs","events","pen","touch","sampling"}) {
                    clean.put(field,report.get(field));
                }
                byte[] body=clean.toString(2).getBytes(StandardCharsets.UTF_8);
                if(body.length>MAX_REPORT_BYTES) throw new IllegalArgumentException();
                pendingReport=body;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").putExtra(Intent.EXTRA_TITLE,"guided-reader-pen-check.json");
                startActivityForResult(intent,SAVE_REPORT);
            } catch(Exception ignored) {pendingReport=null;toast("测试结果尚未准备好，请在试写页面重试。");}
        });
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==PICK_PDF) {
            ValueCallback<Uri[]> callback=fileCallback;fileCallback=null;
            if(callback==null)return;
            List<Uri> values=new ArrayList<>();
            if(result==RESULT_OK&&data!=null) {
                ClipData clip=data.getClipData();
                if(clip!=null) for(int index=0;index<clip.getItemCount();index++) addContentUri(values,clip.getItemAt(index).getUri());
                else addContentUri(values,data.getData());
            }
            callback.onReceiveValue(values.isEmpty()?null:values.toArray(new Uri[0]));
        } else if(request==SAVE_REPORT) {
            byte[] body=pendingReport;pendingReport=null;
            Uri destination=data==null?null:data.getData();
            if(result!=RESULT_OK||body==null||destination==null)return;
            if(!"content".equals(destination.getScheme())) {toast("保存位置无效，请通过系统文件界面重新选择。");return;}
            new Thread(()->{
                try(OutputStream output=getContentResolver().openOutputStream(destination,"wt")) {
                    if(output==null)throw new IllegalStateException();output.write(body);
                    runOnUiThread(()->toast("测试 JSON 已保存。"));
                }catch(Exception ignored){runOnUiThread(()->toast("测试结果保存失败，请重新选择保存位置。"));}
            },"reader-probe-save").start();
        } else if(request==PICK_LIBRARY && result==RESULT_OK && data!=null) {
            importLibraryArchive(data.getData());
        }
    }

    private static void addContentUri(List<Uri> values,Uri uri) {if(uri!=null&&"content".equals(uri.getScheme()))values.add(uri);}
    private void cancelFileChooser() {if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}}
    private void notifyPageBlur() {if(webView!=null)webView.evaluateJavascript("window.dispatchEvent(new Event('blur'));",null);}
    private void toast(String message) {runOnUiThread(()->Toast.makeText(this,message,Toast.LENGTH_LONG).show());}
    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color) {TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(getColor(color));view.setLineSpacing(dp(3),1);return view;}
    private Button button(String text) {Button button=new Button(this);button.setText(text);button.setAllCaps(false);button.setMinHeight(dp(48));return button;}
    private LinearLayout.LayoutParams spaced(int weight,int top) {LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2,weight);params.topMargin=dp(top);return params;}

    @Override public void onConfigurationChanged(Configuration configuration) {super.onConfigurationChanged(configuration);configureInsets();}
    @Override public void onBackPressed() {handleBack();}
    @Override protected void onPause() {notifyPageBlur();CookieManager.getInstance().flush();webView.onPause();super.onPause();}
    @Override protected void onResume() {super.onResume();if(webView!=null){webView.onResume();if(coreReady&&!libraryBusy)refreshAiSettings();}}
    @Override protected void onDestroy() {cancelFileChooser();pendingReport=null;if(webView!=null){root.removeView(webView);webView.destroy();}super.onDestroy();}
}

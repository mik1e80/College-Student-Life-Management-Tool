package cn.yiriyoushu.campuslife;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.AtomicFile;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.Locale;
import java.util.UUID;

/** An offline host for the bundled ledger. No app-level network permission. */
public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/assets/index.html";
    private static final int CREATE_EXPORT = 1001;
    private static final int MAX_EXPORT_BYTES = 1024 * 1024;
    private static final int MAX_LEDGER_BYTES = 4 * 1024 * 1024;
    private static final Object LEDGER_LOCK = new Object();
    private static final String EXPORT_STATE = "pendingExportToken";
    private WebView webView;
    private String pendingExportToken;
    private boolean writingExport;
    private OnBackInvokedCallback backCallback;

    @Override
    @SuppressWarnings("deprecation")
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            String token = savedInstanceState.getString(EXPORT_STATE);
            if (token != null && token.matches("[a-f0-9-]{36}")) pendingExportToken = token;
        }

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(246, 247, 242));
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(container);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(246, 247, 242));
        container.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " YiriAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"GET".equals(request.getMethod()) || !isLocalAsset(request.getUrl())) return blocked(403);
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : blocked(404);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isAppDocument(request.getUrl())) return false;
                if (request.isForMainFrame()) openExternal(request.getUrl());
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (!isAppDocument(Uri.parse(url))) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name)
                        .setMessage(message).setPositiveButton("知道了", (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!isAppDocument(Uri.parse(url))) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name)
                        .setMessage(message).setPositiveButton("确定", (dialog, which) -> result.confirm())
                        .setNegativeButton("取消", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        // Always start the trusted bundled document, never restore a URL supplied by an Intent.
        webView.loadUrl(APP_URL);
        container.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::requestBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private static boolean isLocalAsset(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && APP_HOST.equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null && uri.getPath() != null
                && uri.getPath().startsWith("/assets/")
                && !uri.getPath().contains("/../") && !uri.getPath().contains("\\");
    }

    private static boolean isAppDocument(Uri uri) {
        return isLocalAsset(uri) && "/assets/index.html".equals(uri.getPath());
    }

    private boolean isTrustedPage() {
        return webView != null && isAppDocument(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()));
    }

    private static WebResourceResponse blocked(int status) {
        byte[] text = (status == 403 ? "External resources are disabled." : "Local resource not found.")
                .getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/plain", "UTF-8", status,
                status == 403 ? "Forbidden" : "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(text));
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "未找到可以打开链接的浏览器", Toast.LENGTH_SHORT).show();
        }
    }

    private void requestBack() {
        if (!isTrustedPage()) { finish(); return; }
        // The web app owns its in-memory routes, modal dialogs and unsaved-input confirmation.
        webView.evaluateJavascript("(() => { if (typeof window.YiriNativeBack === 'function') {"
                + "window.YiriNativeBack(); return true; } return false; })()", handled -> {
            if ("false".equals(handled) && !isFinishing()) finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { requestBack(); }

    private final class AppBridge {
        @JavascriptInterface
        public boolean isNative() { return true; }

        @JavascriptInterface
        public String loadLedger() {
            synchronized (LEDGER_LOCK) {
                AtomicFile file = new AtomicFile(new File(getFilesDir(), "ledger-checkpoint.json"));
                try { return new String(file.readFully(), StandardCharsets.UTF_8); }
                catch (FileNotFoundException absent) { return null; }
                catch (IOException error) { throw new IllegalStateException("本机账本暂时无法读取，请重试", error); }
            }
        }

        @JavascriptInterface
        public boolean saveLedger(String text) {
            if (text == null || text.length() > MAX_LEDGER_BYTES) return false;
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_LEDGER_BYTES) return false;
            synchronized (LEDGER_LOCK) {
                AtomicFile file = new AtomicFile(new File(getFilesDir(), "ledger-checkpoint.json"));
                FileOutputStream stream = null;
                try {
                    JSONObject ledger = new JSONObject(text);
                    int schema = ledger.getInt("schema");
                    long revision = ledger.getLong("revision");
                    if (schema < 1 || schema > 3 || revision < 0 || revision > 9007199254740991L) return false;
                    // Bridge calls run on WebView's bridge thread. Confirm durability before returning success.
                    stream = file.startWrite();
                    stream.write(bytes);
                    stream.getFD().sync();
                    file.finishWrite(stream);
                    return true;
                } catch (Exception error) {
                    if (stream != null) file.failWrite(stream);
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> { if (isTrustedPage()) finish(); });
        }

        @JavascriptInterface
        public void saveText(String name, String mime, String text) {
            if (text == null || text.length() > MAX_EXPORT_BYTES) {
                runOnUiThread(() -> exportResult(false, "导出内容不能超过 1 MiB"));
                return;
            }
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_EXPORT_BYTES) {
                runOnUiThread(() -> exportResult(false, "导出内容不能超过 1 MiB"));
                return;
            }
            String mediaType = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            if (!mediaType.equals("application/json") && !mediaType.equals("text/csv")) {
                runOnUiThread(() -> exportResult(false, "不支持的备份文件类型"));
                return;
            }
            String suggested = name == null ? "一日有数-备份" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (suggested.length() > 120) suggested = suggested.substring(0, 120);
            if (suggested.trim().isEmpty()) suggested = "一日有数-备份";
            final String safeName = suggested;
            runOnUiThread(() -> beginExport(safeName, mediaType, bytes));
        }
    }

    private File exportFile(String token) { return new File(getCacheDir(), "yiri-export-" + token + ".tmp"); }

    private void beginExport(String name, String mime, byte[] bytes) {
        if (!isTrustedPage()) return;
        if (pendingExportToken != null || writingExport) {
            exportResult(false, "上一份备份仍在保存，请完成后再试");
            return;
        }
        pendingExportToken = UUID.randomUUID().toString();
        try {
            // A private temporary copy survives Activity/process recreation while the picker is open.
            Files.write(exportFile(pendingExportToken).toPath(), bytes);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
                    .putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(intent, CREATE_EXPORT);
        } catch (IOException | ActivityNotFoundException error) {
            clearPendingExport();
            exportResult(false, "无法打开文件保存窗口，请重试");
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CREATE_EXPORT) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            clearPendingExport();
            exportResult(false, "已取消保存");
            return;
        }
        if (pendingExportToken == null) { exportResult(false, "保存已中断，请重新导出"); return; }
        Uri target = data.getData();
        File pending = exportFile(pendingExportToken);
        writingExport = true;
        new Thread(() -> {
            boolean success = false;
            try {
                long size = Files.size(pending.toPath());
                if (size > MAX_EXPORT_BYTES) throw new IOException("Export exceeds size limit");
                byte[] bytes = Files.readAllBytes(pending.toPath());
                try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                    if (output == null) throw new IOException("No destination stream");
                    output.write(bytes);
                }
                success = true;
            } catch (IOException | SecurityException error) {
                // The original ledger is untouched if the destination is unavailable.
            }
            final boolean saved = success;
            runOnUiThread(() -> {
                clearPendingExport();
                writingExport = false;
                exportResult(saved, saved ? "备份已保存" : "保存失败，请重新选择保存位置");
            });
        }, "yiri-export").start();
    }

    private void clearPendingExport() {
        if (pendingExportToken != null) exportFile(pendingExportToken).delete();
        pendingExportToken = null;
    }

    private void exportResult(boolean success, String message) {
        if (isFinishing() || isDestroyed() || !isTrustedPage()) return;
        webView.evaluateJavascript("window.YiriNativeExportResult && window.YiriNativeExportResult("
                + success + ", " + JSONObject.quote(message) + ");", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (pendingExportToken != null) state.putString(EXPORT_STATE, pendingExportToken);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        // Never clear WebView storage: records must survive restarts and signed app updates.
        super.onDestroy();
    }
}

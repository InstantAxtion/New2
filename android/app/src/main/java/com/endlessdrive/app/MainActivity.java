package com.endlessdrive.app;

import android.net.Uri;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(PipPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep the screen on while cruising
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // Keep the layout as designed: a large system font size would otherwise overflow the buttons
        settings.setTextZoom(100);
        // Look like the phone's Chrome browser rather than an embedded web view: Spotify's player only
        // plays full songs (instead of 30-second previews) in browsers it recognises
        settings.setUserAgentString(chromeUserAgent(settings.getUserAgentString()));
        // Let the Spotify and YouTube players start playback and keep the Spotify login
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);


        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    /** The web view's user agent with the "; wv" and "Version/4.0" markers taken out. */
    static String chromeUserAgent(String ua) {
        if (ua == null) return null;
        return ua.replace("; wv)", ")").replaceAll("Version/\\d+(\\.\\d+)* ", "");
    }

    // ---- Picture in picture: a playing music video carries on in a small floating window ----

    private boolean pipAllowed = false;

    void setPipAllowed(boolean on) {
        pipAllowed = on;
        if (Build.VERSION.SDK_INT >= 26) {
            PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
            // Android 12+: go into the window by itself when you swipe home
            if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(on).setSeamlessResizeEnabled(true);
            try { setPictureInPictureParams(b.build()); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (pipAllowed && Build.VERSION.SDK_INT >= 26 && Build.VERSION.SDK_INT < 31) {
            try {
                enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build());
            } catch (Exception ignored) { }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        WebView wv = getBridge().getWebView();
        wv.post(() -> wv.evaluateJavascript("window.dispatchEvent(new CustomEvent('pipmode', { detail: " + inPip + " }))", null));
    }
}

package com.endlessdrive.app;

import android.net.Uri;
import android.os.Bundle;
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
        registerPlugin(SpotifyLoginPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep the screen on while cruising
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // Keep the layout as designed: a large system font size would otherwise overflow the buttons
        settings.setTextZoom(100);
        // Let the Spotify and YouTube players start playback and keep the Spotify login
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // When the Spotify player's own "Log in" opens, log in inside the app instead of the
        // phone's browser (the browser's login wouldn't reach the player)
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                if (host.equals("accounts.spotify.com") || host.equals("challenge.spotify.com")) {
                    PluginHandle h = getBridge().getPlugin("SpotifyLogin");
                    if (h != null) {
                        ((SpotifyLoginPlugin) h.getInstance()).openFromPlayer(url.toString());
                        return true;
                    }
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });

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
}

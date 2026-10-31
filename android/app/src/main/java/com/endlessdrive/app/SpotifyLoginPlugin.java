package com.endlessdrive.app;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Logs in to Spotify inside the app (not the phone's browser), so the Spotify player in
 * the game shares the login and can play full songs.
 */
@CapacitorPlugin(name = "SpotifyLogin")
public class SpotifyLoginPlugin extends Plugin {
    private static final String LOGIN = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

    /** Is the app logged in to Spotify? */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loggedIn", isLoggedIn());
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> show(getActivity(), LOGIN, () -> {
            JSObject ret = new JSObject();
            ret.put("loggedIn", isLoggedIn());
            call.resolve(ret);
            notifyListeners("loginFinished", ret);
        }));
    }

    @PluginMethod
    public void logout(PluginCall call) {
        CookieManager cm = CookieManager.getInstance();
        for (String host : new String[] { "https://open.spotify.com", "https://accounts.spotify.com", "https://spotify.com" }) {
            String cookies = cm.getCookie(host);
            if (cookies == null) continue;
            for (String c : cookies.split(";")) {
                String name = c.split("=")[0].trim();
                cm.setCookie(host, name + "=; Max-Age=0; Domain=.spotify.com; Path=/");
            }
        }
        cm.flush();
        JSObject ret = new JSObject();
        ret.put("loggedIn", isLoggedIn());
        call.resolve(ret);
    }

    /** Called when the Spotify player itself asks to log in. */
    void openFromPlayer(String url) {
        Activity a = getActivity();
        a.runOnUiThread(() -> show(a, url, () -> {
            JSObject ret = new JSObject();
            ret.put("loggedIn", isLoggedIn());
            notifyListeners("loginFinished", ret);
        }));
    }

    static boolean isLoggedIn() {
        String c = CookieManager.getInstance().getCookie("https://open.spotify.com");
        return c != null && c.contains("sp_dc=");
    }

    private static void show(Activity activity, String url, Runnable done) {
        Dialog dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen);
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.parseColor("#121212"));

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(32, 16, 16, 16);
        TextView title = new TextView(activity);
        title.setText("Log in to Spotify");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(activity);
        close.setText("Done");
        bar.addView(close);
        layout.addView(bar);

        WebView web = new WebView(activity);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(MainActivity.chromeUserAgent(s.getUserAgentString()));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // keep the whole login inside this window
            }

            @Override
            public void onPageFinished(WebView view, String loaded) {
                // Logged in and sent on to the Spotify web player: we're done
                Uri u = Uri.parse(loaded);
                if ("open.spotify.com".equals(u.getHost()) && isLoggedIn()) dialog.dismiss();
            }
        });
        layout.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(layout);
        close.setOnClickListener(v -> dialog.dismiss());
        dialog.setOnDismissListener(d -> {
            CookieManager.getInstance().flush();
            web.destroy();
            done.run();
        });
        web.loadUrl(url);
        dialog.show();
    }
}

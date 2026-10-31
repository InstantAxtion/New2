package com.endlessdrive.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The web app's handle on AudioService: play the radio or a podcast so it carries on in the background. */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        AudioService.listener = () -> main.post(() -> notifyListeners("state", state()));
    }

    private JSObject state() {
        AudioService s = AudioService.instance;
        JSObject o = new JSObject();
        o.put("active", s != null);
        o.put("playing", s != null && (s.isPlaying() || (s.wantPlay && !s.prepared && s.error.isEmpty())));
        o.put("position", s != null ? s.position() / 1000.0 : 0);
        o.put("duration", s != null ? s.duration() / 1000.0 : 0);
        o.put("error", s != null ? s.error : "");
        return o;
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("No url");
            return;
        }
        String title = call.getString("title", "");
        String subtitle = call.getString("subtitle", "");
        boolean live = Boolean.TRUE.equals(call.getBoolean("live", false));
        int pos = (int) Math.round(call.getDouble("position", 0.0) * 1000);
        // Android 13+: ask once to show the playback notification (playback works either way)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 71);
        }
        Intent i = new Intent(getContext(), AudioService.class);
        ContextCompat.startForegroundService(getContext(), i);
        withService(s -> s.play(url, title, subtitle, live, pos));
        call.resolve();
    }

    /** The service starts asynchronously: wait for it (briefly) before talking to it. */
    private void withService(java.util.function.Consumer<AudioService> f) {
        final int[] tries = { 0 };
        Runnable r = new Runnable() {
            @Override public void run() {
                AudioService s = AudioService.instance;
                if (s != null) f.accept(s);
                else if (tries[0]++ < 40) main.postDelayed(this, 25);
            }
        };
        main.post(r);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.pause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.resume();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.stopAll();
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.seek((int) Math.round(call.getDouble("position", 0.0) * 1000));
        call.resolve();
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.setRate(call.getFloat("rate", 1f));
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        if (AudioService.instance != null) AudioService.instance.setVolume(call.getFloat("volume", 1f));
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }
}

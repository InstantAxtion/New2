package com.endlessdrive.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Plays the radio and podcasts outside the web view, as a media foreground service, so they
 * keep going with the screen off or while you use another app. Shows a notification with
 * play/pause and stop, and lock-screen controls.
 */
public class AudioService extends Service {
    static final String CHANNEL = "playback";
    static final int NOTE_ID = 7;
    static final String ACT_TOGGLE = "com.endlessdrive.app.TOGGLE";
    static final String ACT_STOP = "com.endlessdrive.app.STOP";

    /** The one running service (the plugin talks to it directly). */
    static AudioService instance;
    /** Called whenever playback state changes. */
    static Runnable listener;

    private MediaPlayer player;
    private MediaSession session;
    private WifiManager.WifiLock wifi;
    String title = "";
    String subtitle = "";
    boolean live;
    boolean prepared;
    boolean wantPlay;
    /** The episode or chapter played to its end. */
    boolean completed;
    String error = "";
    private float rate = 1f;
    private float volume = 1f;
    private int startAt;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Music and podcasts", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "EndlessDrive");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { stopAll(); }
        });
        session.setActive(true);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "EndlessDrive:audio");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if (ACT_TOGGLE.equals(act)) {
            if (isPlaying()) pause(); else resume();
        } else if (ACT_STOP.equals(act)) {
            stopAll();
            return START_NOT_STICKY;
        }
        foreground();
        return START_NOT_STICKY;
    }

    void play(String url, String t, String sub, boolean isLive, int positionMs) {
        release();
        title = t;
        subtitle = sub;
        live = isLive;
        startAt = positionMs;
        prepared = false;
        wantPlay = true;
        completed = false;
        error = "";
        player = new MediaPlayer();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(isLive ? AudioAttributes.CONTENT_TYPE_MUSIC : AudioAttributes.CONTENT_TYPE_SPEECH).build());
        player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        player.setVolume(volume, volume);
        player.setOnPreparedListener(mp -> {
            prepared = true;
            if (startAt > 0 && !live) mp.seekTo(startAt);
            applyRate();
            if (wantPlay) mp.start();
            changed();
        });
        player.setOnErrorListener((mp, what, extra) -> {
            error = "Couldn't play this.";
            prepared = false;
            changed();
            return true;
        });
        player.setOnCompletionListener(mp -> {
            completed = true;
            wantPlay = false;
            changed();
        });
        try {
            player.setDataSource(url);
            player.prepareAsync();
        } catch (Exception e) {
            error = "Couldn't play this.";
        }
        if (wifi != null && !wifi.isHeld()) wifi.acquire();
        foreground();
        changed();
    }

    void pause() {
        wantPlay = false;
        if (player != null && prepared && player.isPlaying()) player.pause();
        changed();
    }

    void resume() {
        wantPlay = true;
        if (player != null && prepared) {
            player.start();
            applyRate();
        }
        changed();
    }

    void seek(int ms) {
        if (player != null && prepared && !live) player.seekTo(Math.max(0, ms));
        changed();
    }

    void setRate(float r) {
        rate = r;
        applyRate();
    }

    void setVolume(float v) {
        volume = v;
        if (player != null) player.setVolume(v, v);
    }

    private void applyRate() {
        if (player == null || !prepared || live || Build.VERSION.SDK_INT < 23) return;
        try {
            boolean was = player.isPlaying();
            player.setPlaybackParams(new PlaybackParams().setSpeed(rate));
            if (!was && !wantPlay) player.pause();
        } catch (Exception ignored) {
        }
    }

    boolean isPlaying() {
        return player != null && prepared && player.isPlaying();
    }

    int position() {
        return player != null && prepared ? player.getCurrentPosition() : startAt;
    }

    int duration() {
        return player != null && prepared && !live ? Math.max(0, player.getDuration()) : 0;
    }

    void stopAll() {
        release();
        changed();
        stopForeground(true);
        stopSelf();
    }

    private void release() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        prepared = false;
        if (wifi != null && wifi.isHeld()) wifi.release();
    }

    private void changed() {
        boolean playing = isPlaying() || (wantPlay && player != null && !prepared && error.isEmpty());
        PlaybackState.Builder st = new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position(), playing ? rate : 0f);
        session.setPlaybackState(st.build());
        if (player != null) foreground();
        if (listener != null) listener.run();
    }

    private void foreground() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, AudioService.class).setAction(ACT_TOGGLE), flags);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, AudioService.class).setAction(ACT_STOP), flags);
        boolean playing = isPlaying() || wantPlay;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setContentIntent(content)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(null, playing ? "Pause" : "Play", toggle).build())
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1));
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE_ID, n);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away stops the music too
        stopAll();
    }

    @Override
    public void onDestroy() {
        release();
        session.release();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

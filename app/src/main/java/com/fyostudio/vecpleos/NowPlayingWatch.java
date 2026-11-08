package com.fyostudio.vecpleos;

import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import java.util.List;
import org.json.JSONObject;

// 바깥 재생기 연결점(11-07 광호님 「공모전은 실시간 감지로. 수상 후 현대와 디벨롭하게 되면 그때를 위해 연결점은 만들어 두자」)
//   차에서 다른 미디어 앱(스트리밍)이 재생 중인 곡의 정보(제목·가수·길이·재생 위치)를 화면의 vecSync.track(...) 으로 넘긴다.
//   화면은 그 곡의 분석 자료를 찾으면 미리 짠 연출로, 못 찾으면 지금처럼 실시간 감지로 따라간다(star-drive-proto/vecsync.js).
//   공모전판은 꺼 둔다(ENABLED = false): 다른 앱의 재생 정보를 읽는 권한(MEDIA_CONTENT_CONTROL)은 시스템 앱에만 주어진다.
//   현대와 진행하게 되면: 그 권한(또는 플레오스가 주는 미디어 API)을 받고 ENABLED 를 켠다. 곡 소리 자체는 받지 않는다(저작권 보호 음원)
public class NowPlayingWatch implements MediaSessionManager.OnActiveSessionsChangedListener {
    public static final boolean ENABLED = false;
    private static final String TAG = "NowPlayingWatch";

    public interface Out { void track(String json); }

    private final Context ctx;
    private final Out out;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private MediaSessionManager msm;
    private MediaController cur;
    private final MediaController.Callback cb = new MediaController.Callback() {
        @Override public void onMetadataChanged(MediaMetadata m) { push(); }
        @Override public void onPlaybackStateChanged(PlaybackState s) { push(); }
        @Override public void onSessionDestroyed() { pick(null); }
    };

    public NowPlayingWatch(Context ctx, Out out) { this.ctx = ctx; this.out = out; }

    public void start() {
        if (!ENABLED) return;
        try {
            msm = ctx.getSystemService(MediaSessionManager.class);
            msm.addOnActiveSessionsChangedListener(this, null, ui);
            onActiveSessionsChanged(msm.getActiveSessions(null));
        } catch (SecurityException e) {
            Log.i(TAG, "다른 앱의 재생 정보를 읽을 권한이 없다: 실시간 감지로만 따라간다");
            msm = null;
        }
    }

    public void stop() {
        if (msm != null) try { msm.removeOnActiveSessionsChangedListener(this); } catch (Exception ignored) {}
        pick(null);
    }

    @Override public void onActiveSessionsChanged(List<MediaController> list) {
        MediaController best = null;
        if (list != null) for (MediaController c : list) {
            if (ctx.getPackageName().equals(c.getPackageName())) continue;   // 우리 앱 곡은 화면이 이미 안다
            PlaybackState s = c.getPlaybackState();
            if (best == null || (s != null && s.getState() == PlaybackState.STATE_PLAYING)) best = c;
        }
        pick(best);
    }

    private void pick(MediaController c) {
        if (cur != null && (c == null || !cur.getSessionToken().equals(c.getSessionToken()))) { cur.unregisterCallback(cb); cur = null; out.track("null"); }
        if (c != null && cur == null) { cur = c; cur.registerCallback(cb, ui); push(); }
    }

    private void push() {
        if (cur == null) return;
        MediaMetadata m = cur.getMetadata();
        PlaybackState s = cur.getPlaybackState();
        if (m == null) return;
        try {
            JSONObject j = new JSONObject();
            j.put("id", str(m, MediaMetadata.METADATA_KEY_MEDIA_ID));
            j.put("title", str(m, MediaMetadata.METADATA_KEY_TITLE));
            j.put("artist", str(m, MediaMetadata.METADATA_KEY_ARTIST));
            j.put("album", str(m, MediaMetadata.METADATA_KEY_ALBUM));
            j.put("duration", m.getLong(MediaMetadata.METADATA_KEY_DURATION) / 1000.0);
            boolean playing = s != null && s.getState() == PlaybackState.STATE_PLAYING;
            double pos = 0;
            if (s != null && s.getPosition() >= 0) {   // 마지막으로 알려 준 위치 + 그 뒤 흐른 시간
                pos = s.getPosition() + (playing ? (SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime()) * s.getPlaybackSpeed() : 0);
            }
            j.put("position", pos / 1000.0);
            j.put("playing", playing);
            j.put("source", cur.getPackageName());
            out.track(j.toString());
        } catch (Exception e) { Log.w(TAG, "곡 정보 만들기 실패", e); }
    }

    private static String str(MediaMetadata m, String k) { CharSequence v = m.getText(k); return v == null ? "" : v.toString(); }
}

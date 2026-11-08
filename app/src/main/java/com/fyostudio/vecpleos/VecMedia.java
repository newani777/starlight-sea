package com.fyostudio.vecpleos;

import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;

// 미디어 세션 한 개를 앱 전체가 함께 쓴다. 서비스(VecMediaService)는 이 세션을 시스템 미디어 화면에 열고,
// 화면(MainActivity)은 재생 상태를 써 넣는다. 시스템·핸들에서 온 명령은 떠 있는 화면으로 넘기고, 화면이 없으면 앱을 연다
final class VecMedia {
    static final String[] SONGS = { "42dot VEC", "별빛 레코드 합창", "별에서 온 레코드 보사노바", "너와 나의 봄날" };
    interface Player { void command(String js); }
    static volatile Player player;
    private static MediaSession session;

    static synchronized MediaSession get(Context c) {
        if (session != null) return session;
        Context app = c.getApplicationContext();
        session = new MediaSession(app, "별빛 바다");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send(app, "vecCar.focus(true)"); }
            @Override public void onPause() { send(app, "vecCar.focus(false)"); }
            @Override public void onStop() { send(app, "vecCar.focus(false)"); }
            @Override public void onSkipToNext() { send(app, "vecCar.next()"); }
            @Override public void onSkipToPrevious() { send(app, "vecCar.prev()"); }
            @Override public void onPlayFromMediaId(String id, android.os.Bundle extras) {
                int i; try { i = Integer.parseInt(id); } catch (NumberFormatException e) { i = 0; }
                send(app, "vecCar.play(" + Math.max(0, Math.min(SONGS.length - 1, i)) + ")");
            }
        });
        session.setPlaybackState(state(false));
        session.setActive(true);
        return session;
    }

    static PlaybackState state(boolean playing) {
        return new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build();
    }

    static void nowPlaying(Context c, String title, boolean playing) {
        MediaSession s = get(c);
        s.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "별빛 바다").build());
        s.setPlaybackState(state(playing));
    }

    private static void send(Context app, String js) {
        Player p = player;
        if (p != null) { p.command(js); return; }
        Intent i = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("cmd", js);   // 화면이 없으면 앱을 열고, 열린 뒤 명령을 잇는다
        app.startActivity(i);
    }

    static synchronized void release() { if (session != null) { session.release(); session = null; } }
}

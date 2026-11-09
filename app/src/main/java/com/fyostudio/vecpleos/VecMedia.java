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
            @Override public void onStop() { stop(app); }                 // 11-09 Pleos: 시스템 onStop(쓰리핑거 등)은 일시정지가 아니라 정지
            @Override public void onSkipToNext() { send(app, "vecCar.next()"); }
            @Override public void onSkipToPrevious() { send(app, "vecCar.prev()"); }
            @Override public void onPlayFromMediaId(String id, android.os.Bundle extras) {
                int i; try { i = Integer.parseInt(id); } catch (NumberFormatException e) { i = 0; }
                send(app, "vecCar.play(" + Math.max(0, Math.min(SONGS.length - 1, i)) + ")");
            }
            // 11-09 Pleos Music/Audio 가이드 최소 기능 「검색 기반 재생」: 곡 이름에 검색어가 들어 있으면 그 곡, 없거나 비면 첫 곡
            @Override public void onPlayFromSearch(String query, android.os.Bundle extras) {
                int i = 0; String q = query == null ? "" : query.replace(" ", "").toLowerCase();
                if (!q.isEmpty()) for (int k = 0; k < SONGS.length; k++) if (SONGS[k].replace(" ", "").toLowerCase().contains(q) || q.contains(SONGS[k].replace(" ", "").toLowerCase())) { i = k; break; }
                send(app, "vecCar.play(" + i + ")");
            }
        });
        session.setPlaybackState(state(false));
        session.setActive(true);
        return session;
    }

    static PlaybackState state(boolean playing) {
        return new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID | PlaybackState.ACTION_PLAY_FROM_SEARCH)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build();
    }

    private static Boolean lastPlaying;
    static void nowPlaying(Context c, String title, boolean playing) {
        MediaSession s = get(c);
        if (playing && !s.isActive()) s.setActive(true);                // 포커스를 잃어 꺼 둔 세션은 다시 재생할 때 켠다
        s.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "별빛 바다").build());
        s.setPlaybackState(state(playing));
        if (lastPlaying == null || lastPlaying != playing) {            // 재생이 시작·멈출 때만 서비스 포그라운드를 바꾼다(Pleos 「재생 시점에 startForeground」)
            lastPlaying = playing;
            Intent i = new Intent(c, VecMediaService.class).setAction(VecMediaService.ACTION_FG).putExtra("playing", playing).putExtra("title", title);
            try { c.startService(i); } catch (RuntimeException ignored) {}
        }
    }

    // 앱 작업이 지워질 때(onTaskRemoved)·시스템 onStop: 재생을 멈추고 세션을 정지 상태로
    static void stop(Context c) {
        Player p = player;
        if (p != null) p.command("vecCar.focus(false)");
        stopped(c, false);
    }

    // 11-09 Pleos Music/Audio 가이드: AUDIOFOCUS_LOSS 뒤 세션이 active 로 남지 않게 → 정지 + 비활성화 + 포그라운드 내림.
    //   (소리는 이미 웹뷰가 멈췄다. 잠깐 잃은 경우 웹뷰가 다시 틀면 nowPlaying(true) 가 세션을 다시 켠다)
    static void focusLost(Context c) { stopped(c, true); }

    private static void stopped(Context c, boolean deactivate) {
        if (session == null) return;
        session.setPlaybackState(new PlaybackState.Builder().setActions(state(false).getActions())
            .setState(PlaybackState.STATE_STOPPED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f).build());
        if (deactivate) session.setActive(false);
        if (!Boolean.FALSE.equals(lastPlaying)) {
            lastPlaying = false;
            try { c.startService(new Intent(c, VecMediaService.class).setAction(VecMediaService.ACTION_FG).putExtra("playing", false)); } catch (RuntimeException ignored) {}
        }
    }

    private static void send(Context app, String js) {
        Player p = player;
        if (p != null) { p.command(js); return; }
        Intent i = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("cmd", js);   // 화면이 없으면 앱을 열고, 열린 뒤 명령을 잇는다
        app.startActivity(i);
    }

    static synchronized void release() { if (session != null) { session.release(); session = null; } }
}

package com.fyostudio.vecpleos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaDescription;
import android.media.browse.MediaBrowser;
import android.os.Build;
import android.os.Bundle;
import android.service.media.MediaBrowserService;
import java.util.ArrayList;
import java.util.List;

// 음악 앱 등록 요건(운영사무국 11-05 회신, Pleos Music/Audio 앱 개발 가이드): MediaBrowserService 를 구현하고 MediaSession 으로 재생 상태·제어를 연다.
// 11-09 Pleos 가이드 반영:
//   · 하위 카테고리: 단일 목록 대신 「음악」 분류 아래에 곡을 둔다(콘텐츠 유형별 브라우징 구조)
//   · 생명주기: onCreate 에서 스스로 startService(Started 상태), 재생 중에는 startForeground(mediaPlayback), onTaskRemoved 는 정지 → stopSelf → super 순서
public class VecMediaService extends MediaBrowserService {
    private static final String ROOT = "root", MUSIC = "music";
    static final String ACTION_FG = "com.fyostudio.vecpleos.FG";
    private static final String CH = "playback";
    private static final int NOTE_ID = 7;
    private boolean fg;

    @Override public void onCreate() {
        super.onCreate();
        setSessionToken(VecMedia.get(this).getSessionToken());
        try { startService(new Intent(this, VecMediaService.class)); } catch (RuntimeException ignored) {}   // 연결(bind)만 된 경우에도 onTaskRemoved 를 받도록
    }

    @Override public int onStartCommand(Intent i, int flags, int id) {
        if (i != null && ACTION_FG.equals(i.getAction())) foreground(i.getBooleanExtra("playing", false), i.getStringExtra("title"));
        return START_NOT_STICKY;
    }

    // 재생 중에만 포그라운드(알림은 조용히: 미디어 앱은 헤드업 알림 금지)
    private void foreground(boolean playing, String title) {
        if (playing) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(new NotificationChannel(CH, "재생", NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
            Notification n = new Notification.Builder(this, CH).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title == null ? "별빛 바다" : title)
                .setContentText("별빛 바다").setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .setStyle(new Notification.MediaStyle().setMediaSession(VecMedia.get(this).getSessionToken())).build();
            try {
                if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK); else startForeground(NOTE_ID, n);
                fg = true;
            } catch (RuntimeException ignored) {}                         // 백그라운드에서 포그라운드 시작이 막힌 경우: 재생은 화면 쪽에서 계속된다
        } else if (fg) { stopForeground(STOP_FOREGROUND_REMOVE); fg = false; }
    }

    @Override public void onTaskRemoved(Intent root) {
        VecMedia.stop(this);                                             // 1) 재생 정지
        stopSelf();                                                      // 2) 서비스 정지
        super.onTaskRemoved(root);                                       // 3) 마지막에 super
    }

    // 11-09 Pleos 심사(접근 제어): 목록은 시스템(차량 미디어 화면·Gleo 등 시스템 앱)과 이 앱에만 연다
    @Override public BrowserRoot onGetRoot(String pkg, int uid, Bundle hints) {
        if (uid == android.os.Process.myUid() || uid == android.os.Process.SYSTEM_UID) return new BrowserRoot(ROOT, null);
        try {
            android.content.pm.ApplicationInfo ai = getPackageManager().getApplicationInfo(pkg, 0);
            if ((ai.flags & (android.content.pm.ApplicationInfo.FLAG_SYSTEM | android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0 && ai.uid == uid) return new BrowserRoot(ROOT, null);
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {}
        android.util.Log.w("VecMedia", "목록 요청 거절: " + pkg);
        return null;
    }

    @Override public void onLoadChildren(String parent, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> items = new ArrayList<>();
        if (ROOT.equals(parent)) {                                       // 맨 위: 하위 카테고리 「음악(Music)」
            MediaDescription d = new MediaDescription.Builder().setMediaId(MUSIC).setTitle("음악").setSubtitle("별빛 바다 곡").build();
            items.add(new MediaBrowser.MediaItem(d, MediaBrowser.MediaItem.FLAG_BROWSABLE));
        } else if (MUSIC.equals(parent)) {                               // 음악 아래: 앱 곡 네 곡(트랙)
            for (int i = 0; i < VecMedia.SONGS.length; i++) {
                MediaDescription d = new MediaDescription.Builder().setMediaId(String.valueOf(i)).setTitle(VecMedia.SONGS[i]).setSubtitle("별빛 바다").build();
                items.add(new MediaBrowser.MediaItem(d, MediaBrowser.MediaItem.FLAG_PLAYABLE));
            }
        }
        result.sendResult(items);
    }
}

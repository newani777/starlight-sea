package com.fyostudio.vecpleos;

import android.media.MediaDescription;
import android.media.browse.MediaBrowser;
import android.os.Bundle;
import android.service.media.MediaBrowserService;
import java.util.ArrayList;
import java.util.List;

// 음악 앱 등록 요건(운영사무국 11-05 회신): MediaBrowserService 를 구현하고 MediaSession 으로 재생 상태·제어를 연다.
// 차량 미디어 화면에는 내장 세 곡이 목록으로 보이고, 고르면 화면이 그 곡으로 달린다
public class VecMediaService extends MediaBrowserService {
    private static final String ROOT = "root";

    @Override public void onCreate() {
        super.onCreate();
        setSessionToken(VecMedia.get(this).getSessionToken());
    }

    @Override public BrowserRoot onGetRoot(String pkg, int uid, Bundle hints) { return new BrowserRoot(ROOT, null); }

    @Override public void onLoadChildren(String parent, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> items = new ArrayList<>();
        if (ROOT.equals(parent)) {
            for (int i = 0; i < VecMedia.SONGS.length; i++) {
                MediaDescription d = new MediaDescription.Builder().setMediaId(String.valueOf(i)).setTitle(VecMedia.SONGS[i]).setSubtitle("별빛 바다").build();
                items.add(new MediaBrowser.MediaItem(d, MediaBrowser.MediaItem.FLAG_PLAYABLE));
            }
        }
        result.sendResult(items);
    }
}

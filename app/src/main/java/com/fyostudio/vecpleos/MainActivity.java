package com.fyostudio.vecpleos;

import android.app.Activity;
import android.car.Car;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

// 플레오스판 껍데기: 별빛 바다 화면을 띄우고, 차량 값은 넣어 주고, 소리 주도권과 핸들 버튼을 시스템과 맞춘다
public class MainActivity extends Activity implements VecSink {
    // ed=car: 차량 탑재판 시작 메뉴(NOCTURNE 음악 감상 · GRAND VOYAGE · 자유주행). 11-09 광호님 「플레오스판에도 녹턴 모드」
    private static final String URL = "https://appassets.androidplatform.net/assets/www/vec.html?car=1&ed=car&phase=0";
    private WebView web;
    private CarBridge car;
    private PleosBridge pleos;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean loaded, pausedByFocus;
    private String pendingCmd;
    private NowPlayingWatch watch;
    private NaviBridge navi;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // 11-09 Pleos 보안 가이드 「WebView 원격 디버깅 기능을 비활성화」: release 빌드는 어떤 경우에도 끈다. 디버그 빌드에서만 --ez webdebug true 로 켤 수 있다
        boolean debuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable && getIntent().getBooleanExtra("webdebug", false));
        web = new WebView(this);
        setContentView(web);
        hideBars();
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);                                     // 화면은 https://appassets 주소(WebViewAssetLoader)로만 읽는다: 로컬 파일·콘텐츠 접근은 끈다(Pleos 보안 가이드)
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(this, "VecNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override public void onPageFinished(WebView v, String u) { loaded = true; if (pendingCmd != null) { js(pendingCmd); pendingCmd = null; } }
        });
        // 마이크(차 안 소리)는 쓰지 않는다(11-08 광호님 「기기 안 음원을 인풋 신호로 받으니 기능에서 빼자」): 웹 화면의 장치 권한 요청은 모두 거절
        web.setWebChromeClient(new WebChromeClient() { @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); } });
        car = new CarBridge(this, this);
        pleos = new PleosBridge(this, this, car);
        setupAudio();
        pleos.start();
        watch = new NowPlayingWatch(this, json -> js("vecSync.track(" + json + ")"));   // 바깥 재생기 연결점: 공모전판은 꺼져 있다(NowPlayingWatch.ENABLED)
        watch.start();
        navi = new NaviBridge(this, this);                               // 실제 내비 안내(NaviHelper). 내비가 없으면 조용히 쉬고 화면은 경로 프로그램으로
        navi.start();
        pendingCmd = safeCmd(getIntent().getStringExtra("cmd"));       // 차량 미디어 화면에서 곡을 골라 앱이 열린 경우
        // 실시간 속도(CAR_SPEED)는 권한 분류·제공이 아직 확정되지 않았다(11-05 회신). 기본 위치 API(GPS)를 함께 청해 차속이 없으면 그 속도로 대신한다
        String[] want = { Car.PERMISSION_SPEED, android.Manifest.permission.ACCESS_FINE_LOCATION };
        boolean all = true; for (String p : want) all &= checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
        if (all) car.start(); else requestPermissions(want, 1);
        boolean demo = getIntent().getBooleanExtra("demo", false);   // 시연: 주행 중에도 화면을 켜 두고, 교통 시뮬레이션과 가상 속도를 쓴다. 에뮬레이터 발표 전용
        web.loadUrl(demo ? URL + "&demo=1" : URL);
        // 11-09 Pleos CCP 가이드 「최상단에서 Back 하드키 → moveTaskToBack(true), finish() 금지(어기면 심사 반려)」
        if (android.os.Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }

    // 11-09 Pleos 심사(컴포넌트 노출·접근 제어): 바깥에서 넘어온 명령은 앱이 스스로 보내는 미디어 명령 모양만 받는다(임의 JS 실행 차단)
    private static final java.util.regex.Pattern CMD_OK = java.util.regex.Pattern.compile("vecCar\\.(focus\\((true|false)\\)|next\\(\\)|prev\\(\\)|toggle\\(\\)|play\\([0-9]\\))");
    static String safeCmd(String c) { return c != null && CMD_OK.matcher(c).matches() ? c : null; }

    // 뒤로 가기: 화면에 먼저 묻는다(모드 안이면 메뉴로). 메뉴(최상단)면 앱을 끝내지 않고 뒤로 숨긴다 — 음악은 이어진다
    private void handleBack() {
        if (!loaded) { moveTaskToBack(true); return; }
        web.evaluateJavascript("window.vecBack ? vecBack() : false", r -> { if (!"true".equals(r)) moveTaskToBack(true); });
    }
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }           // API 30~32

    @Override public void onRequestPermissionsResult(int c, String[] p, int[] r) {
        car.start();
    }

    // 화면이 소리를 낸다. 오디오 포커스는 운영사무국 11-05 회신의 기본 처리 기준을 따른다:
    //   GAIN 정상 재생 · LOSS 즉시 정지(포커스 반납) · LOSS_TRANSIENT 일시정지 후 되찾으면 복귀 · LOSS_TRANSIENT_CAN_DUCK 소리만 줄임
    // 미디어 세션은 VecMediaService 와 함께 쓰는 하나(VecMedia)로, 차량 미디어 화면·핸들 버튼 명령이 여기로 온다
    private void setupAudio() {
        audio = getSystemService(AudioManager.class);
        AudioAttributes attr = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attr).setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener(this::onFocus).build();
        VecMedia.player = this::js;
        VecMedia.get(this);
        startService(new Intent(this, VecMediaService.class));
    }

    private void onFocus(int c) {
        switch (c) {
            case AudioManager.AUDIOFOCUS_GAIN:
                js("vecCar.duck(false)");
                if (pausedByFocus) { pausedByFocus = false; js("vecCar.focus(true)"); }
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                pausedByFocus = false; js("vecCar.focus(false)"); audio.abandonAudioFocusRequest(focus);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                pausedByFocus = true; js("vecCar.focus(false)");
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                js("vecCar.duck(true)");
                break;
        }
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); String c = safeCmd(i.getStringExtra("cmd")); if (c != null) { if (loaded) js(c); else pendingCmd = c; } }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_NEXT: js("vecCar.next()"); return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: js("vecCar.prev()"); return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: js("vecCar.toggle()"); return true;
            default: return super.dispatchKeyEvent(e);
        }
    }

    // ---------- 차량 값 → 화면 ----------
    @Override public void car(String json) { js("vecCar.feed(" + json + ")"); }
    @Override public void surround(String json) { js("vecSurround.feed(" + json + ")"); }
    @Override public void navi(String json) { js("vecNav.live&&vecNav.live(" + json + ")"); }
    private void js(String code) {
        if (!loaded) return;
        runOnUiThread(() -> web.evaluateJavascript("window.vecCar&&" + code, null));
    }

    // ---------- 화면 → 차량 ----------
    @JavascriptInterface public void setAmbient(int rgb, int brightness) { pleos.setAmbient(rgb, brightness); }

    @JavascriptInterface public void nowPlaying(String title, boolean playing) {
        // 오디오 포커스는 웹뷰(크로미움)가 재생할 때 스스로 청하고, 잃으면 멈추고·잠깐 잃으면 줄였다 되찾는다.
        // 11-09 에뮬레이터 시험: 앱이 따로 포커스를 또 청하면 크로미움 요청에 앱이 LOSS 를 받아 자기 곡을 멈췄다 → 앱은 청하지 않는다.
        VecMedia.nowPlaying(this, title, playing);
    }

    // 화면(웹뷰)이 「앱이 멈추지 않았는데 소리가 멈췄다 = 다른 소리가 포커스를 가져갔다」고 알려 온다
    @JavascriptInterface public void focusLost() { VecMedia.focusLost(getApplicationContext()); }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }
    @Override protected void onStart() { super.onStart(); car.resume(); pleos.resume(); if (navi != null) navi.resume(); }
    @Override protected void onStop() { super.onStop(); car.pause(); pleos.pause(); if (navi != null) navi.pause(); }     // 화면은 저절로 멈추고, 음악은 이어진다
    @Override protected void onDestroy() {
        car.stop(); pleos.stop(); watch.stop(); navi.stop();
        audio.abandonAudioFocusRequest(focus);
        VecMedia.player = null;                                          // 세션은 미디어 서비스가 계속 쥔다
        web.destroy();
        super.onDestroy();
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
}

package com.fyostudio.vecpleos;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import ai.pleos.playground.navi.constants.NaviMode;
import ai.pleos.playground.navi.constants.NavigationStatus;
import ai.pleos.playground.navi.constants.TurnType;
import ai.pleos.playground.navi.data.DestinationArrivedInfo;
import ai.pleos.playground.navi.data.DestinationInfo;
import ai.pleos.playground.navi.data.RouteStateInfo;
import ai.pleos.playground.navi.data.TBTInfo;
import ai.pleos.playground.navi.helper.NaviHelper;
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener;
import java.util.List;
import kotlin.Unit;
import org.json.JSONArray;
import org.json.JSONObject;

// 11-09 광호님 「그랜드 보야지에 NaviHelper(실제 내비 안내) 연동」.
// Pleos Connect 내비게이션 앱의 안내(다음 회전·거리·설명, 남은 거리·시간, 목적지)를 받아 화면의 vecNav.live 로 넘긴다.
// 안내가 오면 그랜드 보야지는 그 안내로 안내판을 그리고 바다의 시선을 회전 쪽으로 기울인다. 안내가 없으면(내비 미탑재·경로 없음) 화면은 기존 경로 프로그램으로 달린다.
// 사용 순서는 Pleos 문서 그대로: 생성 → initialize(onConnected, onFailed) → addListener → 요청 → removeListener → release. 퍼미션 NAVI_ROUTE(get*Info)
final class NaviBridge {
    private static final String TAG = "VecNavi";
    private final Context ctx;
    private final VecSink sink;
    private final Handler main = new Handler(Looper.getMainLooper());
    private NaviHelper navi;
    private boolean connected, routing;
    private String status = "UNKNOWN", mode = "UNKNOWN";
    private List<TBTInfo> tbt;
    private DestinationInfo dest;
    private boolean arrived;
    private String lastJs = "";

    NaviBridge(Context c, VecSink s) { ctx = c.getApplicationContext(); sink = s; }

    void start() {
        try {
            navi = new NaviHelper(ctx);
            navi.initialize(() -> {
                connected = true; Log.i(TAG, "내비 연결");
                navi.addListener(listener);
                ask(); main.postDelayed(poll, 1000);
                return Unit.INSTANCE;
            }, t -> { Log.w(TAG, "내비 연결 실패: " + t); return Unit.INSTANCE; });
        } catch (Throwable t) { Log.w(TAG, "NaviHelper 사용 불가: " + t); navi = null; }   // 내비가 없는 기기: 화면은 경로 프로그램으로
    }

    // 안내 거리는 달리는 동안 줄어든다: 경로 안내 중에는 1초마다 다시 묻는다(이벤트가 바뀔 때만 오는 구현에 대비)
    private int idle;
    private final Runnable poll = new Runnable() { @Override public void run() {
        if (navi == null) return;
        if (routing || ++idle % 3 == 0) ask();                          // 안내 중이 아니면 3초마다만
        main.postDelayed(this, 1000);
    } };

    private void ask() {
        // 상태 이벤트는 바뀔 때만 오므로, 앱이 안내 시작 뒤에 켜져도 알 수 있게 직접 묻는다
        try { navi.getRouteStateInfo(); navi.getTBTInfo(); navi.getDestinationInfo(); } catch (Throwable t) { Log.w(TAG, "조회 실패: " + t); }
    }

    private final NaviHelperEventListener listener = new NaviHelperEventListener() {
        @Override public void onNavigationStatus(NavigationStatus s) { status = String.valueOf(s); if (s == NavigationStatus.ROUTE_DRIVE) { routing = true; arrived = false; } else if (s == NavigationStatus.FREE_DRIVE || s == NavigationStatus.INACTIVE) routing = false; push(); }
        // 안내 중 = naviMode 가 경로 안내(ROUTE_GUIDING) 또는 모의 안내(SIMULATION_GUIDING). isRouting 은 「경로를 찾는 중」이라 쓰지 않는다(11-09 에뮬레이터: 안내 중에도 false)
        @Override public void onRouteStateInfo(RouteStateInfo r) { NaviMode m = r.getNaviMode(); mode = String.valueOf(m); routing = m == NaviMode.ROUTE_GUIDING || m == NaviMode.SIMULATION_GUIDING; push(); }
        @Override public void onTBTInfo(List<TBTInfo> list) { tbt = list; push(); }
        @Override public void onDestinationInfo(DestinationInfo d) { dest = d; push(); }
        @Override public void onDestinationArrived(DestinationArrivedInfo a) { arrived = true; push(); }
        @Override public void onRouteCancelled() { routing = false; tbt = null; dest = null; push(); }
        @Override public void onError(ai.pleos.playground.navi.constants.NaviErrorCode e) { Log.w(TAG, "내비 오류 " + e); }
    };

    // 안내판이 아는 회전 모양(일곱 가지)으로 접는다. side: 왼쪽 -1 · 오른쪽 +1 · 곧게 0
    static String turn(TurnType t) {
        String n = t == null ? "" : t.name();
        if (n.equals("TURN_ARRIVE")) return "arrive";
        if (n.equals("TURN_LEFT") || n.equals("TURN_SHARP_L") || n.equals("TURN_UTURN")) return "left";
        if (n.equals("TURN_RIGHT") || n.equals("TURN_SHARP_R")) return "right";
        if (n.equals("TURN_EXIT_IC_R")) return "exit-right";
        if (n.endsWith("_L")) return "slight-left";
        if (n.endsWith("_R")) return "slight-right";
        return "straight";
    }

    private void push() {
        try {
            JSONObject o = new JSONObject();
            // 상태를 아직 못 받았어도(UNKNOWN) 회전 안내와 남은 거리가 있으면 안내 중으로 본다
            boolean r = routing || ("UNKNOWN".equals(mode) && tbt != null && !tbt.isEmpty() && dest != null && dest.getRemainDistance() > 0);
            o.put("connected", connected).put("routing", r).put("status", status).put("mode", mode).put("arrived", arrived);
            JSONArray a = new JSONArray();
            if (tbt != null) for (TBTInfo t : tbt) {
                if (t == null) continue;
                a.put(new JSONObject().put("turn", turn(t.getType())).put("type", String.valueOf(t.getType())).put("dist", t.getDistance()).put("text", t.getDescription() == null ? "" : t.getDescription()));
                if (a.length() >= 2) break;                          // 안내판은 지금 안내와 그다음 하나만 쓴다
            }
            o.put("tbt", a);
            if (dest != null) o.put("remain", dest.getRemainDistance()).put("time", dest.getRemainTime()).put("dest", dest.getName() == null ? "" : dest.getName())
                .put("lat", dest.getLatitude()).put("lon", dest.getLongitude());
            String js = o.toString();
            if (!js.equals(lastJs)) { lastJs = js; Log.i(TAG, "안내 " + (js.length() > 300 ? js.substring(0, 300) : js)); }   // 바뀔 때만 기록
            sink.navi(js);
        } catch (Throwable t) { Log.w(TAG, "전달 실패: " + t); }
    }

    void stop() {
        main.removeCallbacks(poll);
        if (navi == null) return;
        try { navi.removeListener(listener); navi.release(); } catch (Throwable ignored) {}
        navi = null;
    }
}

package com.fyostudio.vecpleos;

import ai.pleos.playground.vehicle.Vehicle;
import ai.pleos.playground.vehicle.api.Light;
import ai.pleos.playground.vehicle.api.model.area.DoorArea;
import ai.pleos.playground.vehicle.api.model.area.SeatArea;
import ai.pleos.playground.vehicle.constant.area.DoorValue;
import ai.pleos.playground.vehicle.constant.area.TurnSignalValue;
import ai.pleos.playground.vehicle.constant.control.VehicleGear;
import ai.pleos.playground.vehicle.listener.BrakePedalStatusListener;
import ai.pleos.playground.vehicle.listener.DoorPositionListener;
import ai.pleos.playground.vehicle.listener.GearSelectionListener;
import ai.pleos.playground.vehicle.listener.SteeringWheelAngleListener;
import ai.pleos.playground.vehicle.listener.TurnSignalStateListener;
import android.content.Context;
import android.os.SystemClock;
import android.util.Log;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;

// Vehicle SDK 를 잇는다: 기어·핸들·브레이크 페달·방향지시등·문을 받고, 무드등으로 내보낸다.
// 가속 페달 값은 SDK 에 조회·구독 API 가 없어 받지 않는다(운영사무국 11-04 회신: READ_CAR_PEDALS 선언으로도 못 받음).
// 값이 없는 차종이거나 권한이 막혀도 앱은 멈추지 않고, 받은 값으로만 움직인다.
public class PleosBridge implements GearSelectionListener, SteeringWheelAngleListener, BrakePedalStatusListener, TurnSignalStateListener {
    private static final String TAG = "VecPleos";
    private static final long AMBIENT_MS = 200;        // 무드등 갱신 간격. 허용 빈도는 아직 회신 없음 → 보수적으로 200ms·바뀐 값만. 에뮬레이터에선 조명 변화를 눈으로 못 본다(11-04 회신) → 시연 모드는 화면 구석에 보내는 색을 함께 보인다
    private static final float STEER_SIGN = 1f;        // 화면은 왼쪽이 +. 11-09 에뮬레이터 확인: Virtual Console 핸들을 시계 방향(오른쪽) +200 으로 돌리면 SDK 는 -200 → SDK 도 왼쪽이 +
    private final Context ctx;
    private final VecSink sink;
    private final CarBridge car;
    private final Map<SeatArea, Integer> savedColor = new HashMap<>(), savedLevel = new HashMap<>();
    private final Map<DoorArea, DoorPositionListener> doorListeners = new HashMap<>();
    private final Set<DoorArea> openDoors = new HashSet<>();
    private final Function1<Exception, Unit> fail = e -> { Log.w(TAG, "차량 요청 실패", e); return Unit.INSTANCE; };
    private Vehicle vehicle;
    private volatile List<SeatArea> areas = new ArrayList<>();
    private long ambientT;
    private int lastColor, lastLevel = -1;
    private boolean listening;
    // 핸들 각도: 11-09 Pleos Connect 에뮬레이터 v2.1.0 + SDK 2.3.2 에서 구독(registerSteeringWheelAngle)이
    // 소수 각도("-90.0")를 정수로 읽다 NumberFormatException 으로 매번 실패한다. 공개 API 인 현재값 조회를 초당 10번 묻는다.
    private static final long STEER_MS = 100;
    private final android.os.Handler steerPoll = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable steerTick = new Runnable() {
        @Override public void run() {
            if (vehicle == null || !listening) return;
            vehicle.getSteeringWheel().getCurrentSteeringWheelAngle(deg -> { onSteeringWheelAngleUpdated(deg); return Unit.INSTANCE; }, steerFail);
            vehicle.getGear().getCurrentGearSelectionState(g -> { onSelected(g); return Unit.INSTANCE; }, steerFail);   // 기어 구독은 한 번의 P 신호에 P·R 을 함께 보내 믿을 수 없다(11-09 에뮬레이터)
            vehicle.getBrake().getCurrentBrakePedalStatus(on -> { onBrakePedalStatusUpdated(on); return Unit.INSTANCE; }, steerFail);   // 브레이크도 같은 이유("false")로 구독이 실패한다
            steerPoll.postDelayed(this, STEER_MS);
        }
    };
    private long steerFailT;
    private final Function1<Exception, Unit> steerFail = e -> {   // 실패 로그는 10초에 한 번만
        long now = SystemClock.uptimeMillis();
        if (now - steerFailT > 10000) { steerFailT = now; Log.w(TAG, "핸들 각도 조회 실패", e); }
        return Unit.INSTANCE;
    };

    public PleosBridge(Context ctx, VecSink sink, CarBridge car) { this.ctx = ctx; this.sink = sink; this.car = car; }

    // 11-09 Vehicle SDK 문서: getCurrentSteeringWheelAngle 은 「앞바퀴 조향각(핸들 회전각 아님)」. 에뮬레이터 Virtual Console 은 핸들각(-540~540)을 준다.
    //   지원 범위로 둘을 가린다: 최대가 90도 이하면 앞바퀴각 → 화면이 쓰는 핸들각으로 바꾸려고 조향비 14.5 를 곱한다(화면 STEER_RATIO 와 같은 값)
    private volatile float steerScale = 1f;
    private void checkSteerRange() {
        try {
            vehicle.getSteeringWheel().checkSteeringWheelAngleCapabilities((cfg, b) -> {
                float m = Math.max(Math.abs(b.getMinValue()), Math.abs(b.getMaxValue()));
                steerScale = m > 0 && m <= 90 ? 14.5f : 1f;
                Log.i(TAG, "조향각 범위 ±" + m + " → 배율 " + steerScale);
                return Unit.INSTANCE;
            }, fail);
        } catch (RuntimeException e) { Log.w(TAG, "조향각 범위 조회 불가", e); }
    }

    public void start() {
        try {
            vehicle = new Vehicle(ctx);
            vehicle.initialize();
        } catch (RuntimeException e) { Log.w(TAG, "차량 서비스 연결 실패", e); vehicle = null; }
        resume();
    }

    // 앱이 뒤로 숨으면 구독을 끊고 무드등을 탑승자 설정으로 돌려준다
    public void pause() {
        if (vehicle == null || !listening) return;
        listening = false;
        steerPoll.removeCallbacks(steerTick);
        vehicle.getTurnSignal().unregisterTurnSignalState(this);
        for (Map.Entry<DoorArea, DoorPositionListener> d : doorListeners.entrySet()) vehicle.getDoor().unregisterDoorPosition(d.getKey(), d.getValue());
        doorListeners.clear();
        restoreAmbient();
    }

    public void resume() {
        if (vehicle == null || listening) return;
        listening = true;
        resumeT = SystemClock.uptimeMillis();
        steerPoll.post(steerTick);
        vehicle.getTurnSignal().registerTurnSignalState(this);
        vehicle.getDoor().checkDoorPositionCapabilities(map -> { listenDoors(map.keySet()); return Unit.INSTANCE; }, fail);
        checkSteerRange();
        prepareAmbient();
    }

    // 11-09 Vehicle SDK 문서 「비동기 콜백이 끝나기 전에 release 하지 말 것」: 무드등을 탑승자 설정으로 돌려놓는 요청이 끝날 시간을 두고 놓는다
    public void stop() {
        pause();
        final Vehicle v = vehicle;
        vehicle = null;
        if (v != null) steerPoll.postDelayed(() -> { try { v.release(); } catch (RuntimeException ignored) {} }, 800);
    }

    private void listenDoors(Set<DoorArea> list) {
        for (DoorArea a : list) {
            List<DoorValue> v = Arrays.asList(a.getValues());
            if (v.contains(DoorValue.HOOD)) continue;
            DoorPositionListener l = new DoorPositionListener() {
                @Override public void onPositionUpdated(Integer pos) {
                    synchronized (openDoors) { if (pos != null && pos > 0) openDoors.add(a); else openDoors.remove(a); car.setDoors(openDoors.size()); }
                }
                @Override public void onFailed(Exception e) { fail.invoke(e); }
            };
            doorListeners.put(a, l);
            vehicle.getDoor().registerDoorPosition(a, l);
        }
    }

    // ---------- 받기 ----------
    private VehicleGear gearLogged, gearSeen;
    private long resumeT;
    @Override public void onSelected(VehicleGear g) {
        // 같은 값이 조회 두 번(약 0.2초) 이어질 때만 바꾼다: 시작 직후 R 이 잠깐 섞여 들어왔다(11-09 에뮬레이터)
        if (SystemClock.uptimeMillis() - resumeT < 1000) return;   // 연결 직후 0.2초가량 R 을 돌려준다 → 처음 1초는 기어를 믿지 않는다
        if (g != gearSeen) { gearSeen = g; return; }
        String n = gearName(g); if (n != null) car.setGear(n);
        if (g != gearLogged) { gearLogged = g; Log.d(TAG, "기어 " + g + " → " + n); }
    }
    private float steerLogged = Float.NaN;
    @Override public void onSteeringWheelAngleUpdated(Float deg) {
        if (deg == null) return;
        car.setSteer(deg * STEER_SIGN * steerScale);
        if (Float.isNaN(steerLogged) || Math.abs(deg - steerLogged) >= 10f) { steerLogged = deg; Log.d(TAG, "핸들 " + deg); }
    }
    private Boolean brakeLogged;
    @Override public void onBrakePedalStatusUpdated(Boolean on) {
        car.setBrake(Boolean.TRUE.equals(on));
        if (on != null && !on.equals(brakeLogged)) { brakeLogged = on; Log.d(TAG, "브레이크 " + on); }
    }
    @Override public void onTurnSignalStateUpdated(TurnSignalValue v) { car.setTurn(v == TurnSignalValue.LEFT ? -1 : v == TurnSignalValue.RIGHT ? 1 : 0); }
    @Override public void onFailed(Exception e) { fail.invoke(e); }

    static String gearName(VehicleGear g) {
        if (g == VehicleGear.GEAR_UNKNOWN) return null;
        if (g == VehicleGear.GEAR_PARK) return "P";
        if (g == VehicleGear.GEAR_REVERSE) return "R";
        if (g == VehicleGear.GEAR_NEUTRAL) return "N";
        return "D";
    }

    // ---------- 무드등 ----------
    // 11-09 Pleos 문서(Light): 「주행 모드에 따라 무드등 색 자동 변경」(AmbientColorAutoByDriveMode)이 켜져 있으면 차가 앱이 보낸 색을 덮어쓸 수 있다.
    //   앱이 무드등을 쓰는 동안만 끄고, 앱이 뒤로 숨으면 탑승자가 켜 두었던 그대로 돌려준다(조회=CAR_LIGHTS, 설정=CONTROL_CAR_LIGHTS)
    private Boolean savedAuto;
    private void prepareAmbient() {
        Light light = vehicle.getLight();
        try {
            light.getAmbientColorAutoByDriveModeEnabled(on -> {
                savedAuto = on;
                if (Boolean.TRUE.equals(on)) light.setAmbientColorAutoByDriveModeEnabled(false, v -> { Log.d(TAG, "무드등 주행 모드 자동색 끔"); return Unit.INSTANCE; }, fail);
                return Unit.INSTANCE;
            }, fail);
        } catch (RuntimeException e) { Log.w(TAG, "주행 모드 자동색 조회 불가", e); }
        light.checkAmbientLightBrightnessColorCapabilities((cfg, list) -> {
            for (SeatArea a : list) {
                light.getAmbientLightBrightnessColor(a, c -> { savedColor.put(a, c); return Unit.INSTANCE; }, fail);
                light.getAmbientLightBrightness(a, b -> { savedLevel.put(a, b); return Unit.INSTANCE; }, fail);
            }
            areas = list;
            return Unit.INSTANCE;
        }, fail);
        // 11-09 Vehicle SDK 문서 대조: 밝기 범위는 차마다 다를 수 있다(0~100 이라 가정하지 않고 조회), 탑승자가 무드등을 꺼 두었으면 켜지 않는다
        try {
            light.checkAmbientLightBrightnessCapabilities((cfg, map) -> { levelBounds.clear(); levelBounds.putAll(map); return Unit.INSTANCE; }, fail);
            light.checkAmbientLightSwitchCapabilities((cfg, map) -> {
                for (SeatArea a : map.keySet()) light.getAmbientLightSwitch(a, s -> { if (s == ai.pleos.playground.vehicle.constant.control.LightSwitch.OFF) offAreas.add(a); else offAreas.remove(a); return Unit.INSTANCE; }, fail);
                return Unit.INSTANCE;
            }, fail);
        } catch (RuntimeException e) { Log.w(TAG, "무드등 범위·스위치 조회 불가", e); }
    }
    private final Map<SeatArea, ai.pleos.playground.vehicle.api.model.capability.AreaBounds<Integer>> levelBounds = new java.util.concurrent.ConcurrentHashMap<>();
    private final Set<SeatArea> offAreas = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private int level(SeatArea a, int pct) {                          // 화면의 0~100% → 그 자리의 실제 밝기 범위
        ai.pleos.playground.vehicle.api.model.capability.AreaBounds<Integer> b = levelBounds.get(a);
        if (b == null) return pct;
        return Math.round(b.getMinValue() + (b.getMaxValue() - b.getMinValue()) * Math.max(0, Math.min(100, pct)) / 100f);
    }

    public void setAmbient(int rgb, int brightness) {
        long now = SystemClock.uptimeMillis();
        if (vehicle == null || !listening || now - ambientT < AMBIENT_MS) return;
        ambientT = now;
        int argb = 0xFF000000 | rgb;
        Light light = vehicle.getLight();
        for (SeatArea a : areas) {
            if (offAreas.contains(a)) continue;                            // 탑승자가 꺼 둔 자리
            if (argb != lastColor) light.setAmbientLightBrightnessColor(a, argb, (x, y) -> Unit.INSTANCE, fail);
            if (brightness != lastLevel) light.setAmbientLightBrightness(a, level(a, brightness), (x, y) -> Unit.INSTANCE, fail);
        }
        lastColor = argb; lastLevel = brightness;
    }

    private void restoreAmbient() {
        Light light = vehicle.getLight();
        for (Map.Entry<SeatArea, Integer> c : savedColor.entrySet()) light.setAmbientLightBrightnessColor(c.getKey(), c.getValue(), (x, y) -> Unit.INSTANCE, fail);
        for (Map.Entry<SeatArea, Integer> b : savedLevel.entrySet()) light.setAmbientLightBrightness(b.getKey(), b.getValue(), (x, y) -> Unit.INSTANCE, fail);
        if (Boolean.TRUE.equals(savedAuto)) {
            try { light.setAmbientColorAutoByDriveModeEnabled(true, v -> Unit.INSTANCE, fail); } catch (RuntimeException e) { Log.w(TAG, "주행 모드 자동색 복원 실패", e); }
        }
        savedAuto = null;
        lastColor = 0; lastLevel = -1;
    }

    // 주변 차량·보행자: Vehicle SDK 2.3.2 에는 주변 객체 API 가 없다. 제공되면 이 자리로 받는다
    // 차 기준 좌표(m): x 오른쪽, y 앞. 값이 없으면 화면은 물방울을 그리지 않는다
    public void onTracked(String json) { sink.surround(json); }
}

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
    private static final float STEER_SIGN = 1f;        // 화면은 왼쪽이 +. SDK 부호는 에뮬레이터에서 확인한다
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

    public PleosBridge(Context ctx, VecSink sink, CarBridge car) { this.ctx = ctx; this.sink = sink; this.car = car; }

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
        vehicle.getGear().unregisterGearSelection(this);
        vehicle.getSteeringWheel().unregisterSteeringWheelAngle(this);
        vehicle.getBrake().unregisterBrakePedalStatus(this);
        vehicle.getTurnSignal().unregisterTurnSignalState(this);
        for (Map.Entry<DoorArea, DoorPositionListener> d : doorListeners.entrySet()) vehicle.getDoor().unregisterDoorPosition(d.getKey(), d.getValue());
        doorListeners.clear();
        restoreAmbient();
    }

    public void resume() {
        if (vehicle == null || listening) return;
        listening = true;
        vehicle.getGear().registerGearSelection(this);
        vehicle.getSteeringWheel().registerSteeringWheelAngle(this);
        vehicle.getBrake().registerBrakePedalStatus(this);
        vehicle.getTurnSignal().registerTurnSignalState(this);
        vehicle.getDoor().checkDoorPositionCapabilities(map -> { listenDoors(map.keySet()); return Unit.INSTANCE; }, fail);
        prepareAmbient();
    }

    public void stop() {
        pause();
        if (vehicle != null) vehicle.release();
        vehicle = null;
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
    @Override public void onSelected(VehicleGear g) { String n = gearName(g); if (n != null) car.setGear(n); }
    @Override public void onSteeringWheelAngleUpdated(Float deg) { if (deg != null) car.setSteer(deg * STEER_SIGN); }
    @Override public void onBrakePedalStatusUpdated(Boolean on) { car.setBrake(Boolean.TRUE.equals(on)); }
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
    private void prepareAmbient() {
        Light light = vehicle.getLight();
        light.checkAmbientLightBrightnessColorCapabilities((cfg, list) -> {
            for (SeatArea a : list) {
                light.getAmbientLightBrightnessColor(a, c -> { savedColor.put(a, c); return Unit.INSTANCE; }, fail);
                light.getAmbientLightBrightness(a, b -> { savedLevel.put(a, b); return Unit.INSTANCE; }, fail);
            }
            areas = list;
            return Unit.INSTANCE;
        }, fail);
    }

    public void setAmbient(int rgb, int brightness) {
        long now = SystemClock.uptimeMillis();
        if (vehicle == null || !listening || now - ambientT < AMBIENT_MS) return;
        ambientT = now;
        int argb = 0xFF000000 | rgb;
        Light light = vehicle.getLight();
        for (SeatArea a : areas) {
            if (argb != lastColor) light.setAmbientLightBrightnessColor(a, argb, (x, y) -> Unit.INSTANCE, fail);
            if (brightness != lastLevel) light.setAmbientLightBrightness(a, brightness, (x, y) -> Unit.INSTANCE, fail);
        }
        lastColor = argb; lastLevel = brightness;
    }

    private void restoreAmbient() {
        Light light = vehicle.getLight();
        for (Map.Entry<SeatArea, Integer> c : savedColor.entrySet()) light.setAmbientLightBrightnessColor(c.getKey(), c.getValue(), (x, y) -> Unit.INSTANCE, fail);
        for (Map.Entry<SeatArea, Integer> b : savedLevel.entrySet()) light.setAmbientLightBrightness(b.getKey(), b.getValue(), (x, y) -> Unit.INSTANCE, fail);
        lastColor = 0; lastLevel = -1;
    }

    // 주변 차량·보행자: Vehicle SDK 2.3.2 에는 주변 객체 API 가 없다. 제공되면 이 자리로 받는다
    // 차 기준 좌표(m): x 오른쪽, y 앞. 값이 없으면 화면은 물방울을 그리지 않는다
    public void onTracked(String json) { sink.surround(json); }
}

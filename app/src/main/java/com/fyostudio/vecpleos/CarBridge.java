package com.fyostudio.vecpleos;

import android.car.Car;
import android.car.VehiclePropertyIds;
import android.car.drivingstate.CarUxRestrictions;
import android.car.drivingstate.CarUxRestrictionsManager;
import android.car.hardware.CarPropertyValue;
import android.car.hardware.property.CarPropertyManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.SystemClock;
import android.os.Looper;
import android.util.Log;
import java.util.Locale;

// 차량 값을 한곳에 모아 초당 10번 화면으로 넘긴다.
// 실시간 속도는 AAOS 표준 값(PERF_VEHICLE_SPEED)으로 받고, 나머지는 PleosBridge(Vehicle SDK)가 넣어 준다.
// 운영사무국 11-05 회신: PERF_VEHICLE_SPEED 의 실제 권한 분류·제공은 확정되지 않았다 → 3초 동안 차속이 안 오면
// Android 기본 위치 API(GPS 속도, Dangerous 권한 범위로 사용 가능)로 대신한다. 화면에는 출처(src)도 함께 넘긴다.
// 가속 페달 값은 Vehicle SDK 에 API 가 없다(11-04 회신) → 가속·감속은 화면이 속도 변화로 계산한다
public class CarBridge implements CarPropertyManager.CarPropertyEventCallback {
    private static final String TAG = "VecCar";
    private static final long PUSH_MS = 100;
    private final Context ctx;
    private final VecSink sink;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Car car;
    private CarPropertyManager props;
    private boolean listening;
    private volatile float mps = Float.NaN, steer = Float.NaN, gpsMps = Float.NaN;
    private volatile long carT, startT;
    private LocationManager lm;
    private boolean gpsOn;
    private final LocationListener gps = loc -> { if (loc.hasSpeed()) gpsMps = loc.getSpeed(); };
    private volatile String gear;
    private volatile Boolean brake;
    private volatile Integer turn, doors;
    private final Runnable push = new Runnable() {
        @Override public void run() {
            if (!gpsOn && SystemClock.uptimeMillis() - startT > 3000 && SystemClock.uptimeMillis() - carT > 3000) startGps();
            String json = json();
            if (json != null) sink.car(json);
            main.postDelayed(this, PUSH_MS);
        }
    };

    public CarBridge(Context ctx, VecSink sink) { this.ctx = ctx; this.sink = sink; }

    // 11-09 Pleos 주행 규제 개발 가이드: 「앱은 플랫폼이 제공하는 CarUxRestrictions 상태를 기준으로 주행 중 UX 제한을 적용」.
    //   주행 상태 parked(P) · idling(P 아님·속도 0) · moving 중 idling·moving 에서 requiresDistractionOptimization 이 켜진다 → 화면 그리기를 멈춘다.
    //   플랫폼 값이 오면 그것만 따르고(Auto Hold 정차 인정 같은 지역 규칙도 플랫폼이 계산), 못 받으면 화면이 기어·속도로 대신 판단한다.
    private CarUxRestrictionsManager ux;
    private volatile Boolean uxBlock;
    private final CarUxRestrictionsManager.OnUxRestrictionsChangedListener uxL = r -> setUx(r);
    private void setUx(CarUxRestrictions r) {
        boolean b = r != null && r.isRequiresDistractionOptimization();
        if (uxBlock == null || uxBlock != b) Log.i(TAG, "주행 규제 " + (b ? "켜짐" : "꺼짐") + (r == null ? "" : " active=" + r.getActiveRestrictions()));
        uxBlock = b;
    }

    public void start() {
        try {
            car = Car.createCar(ctx);
            props = car == null ? null : (CarPropertyManager) car.getCarManager(Car.PROPERTY_SERVICE);
            ux = car == null ? null : (CarUxRestrictionsManager) car.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE);
        } catch (RuntimeException e) { Log.w(TAG, "차량 서비스 연결 실패", e); }
        resume();
    }

    // 앱이 뒤로 숨으면 차량 값도 끊는다(플레오스 기준: 백그라운드에서 렌더·센서 중단)
    public void pause() {
        main.removeCallbacks(push);
        if (gpsOn && lm != null) lm.removeUpdates(gps);
        gpsOn = false;
        if (props != null && listening) props.unregisterCallback(this);
        listening = false;
        if (ux != null) try { ux.unregisterListener(); } catch (RuntimeException ignored) {}
    }

    public void resume() {
        startT = SystemClock.uptimeMillis();
        if (props != null && !listening) {
            try {
                listening = props.registerCallback(this, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_UI);
            } catch (RuntimeException e) { Log.w(TAG, "속도 권한 없음", e); }
        }
        if (ux != null) {
            try { ux.registerListener(uxL); setUx(ux.getCurrentCarUxRestrictions()); }
            catch (RuntimeException e) { Log.w(TAG, "주행 규제 상태를 못 받음", e); uxBlock = null; }
        }
        main.removeCallbacks(push);
        main.post(push);
    }

    public void stop() {
        pause();
        if (car != null) car.disconnect();
        car = null; props = null;
    }

    private void startGps() {
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            lm = ctx.getSystemService(LocationManager.class);
            if (lm != null) { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500, 0f, gps, Looper.getMainLooper()); gpsOn = true; }
        } catch (RuntimeException e) { Log.w(TAG, "위치 속도를 못 받음", e); }
    }

    public void setSteer(float deg) { steer = deg; }
    public void setGear(String g) { gear = g; }
    public void setBrake(boolean on) { brake = on; }
    public void setTurn(int side) { turn = side; }
    public void setDoors(int open) { doors = open; }

    @Override public void onChangeEvent(CarPropertyValue v) {
        if (v.getStatus() == CarPropertyValue.STATUS_AVAILABLE && v.getPropertyId() == VehiclePropertyIds.PERF_VEHICLE_SPEED) { mps = (Float) v.getValue(); carT = SystemClock.uptimeMillis(); }
    }

    @Override public void onErrorEvent(int id, int zone) { Log.w(TAG, "값 오류 " + VehiclePropertyIds.toString(id)); }

    private String json() {
        StringBuilder s = new StringBuilder();
        boolean carFresh = !Float.isNaN(mps) && SystemClock.uptimeMillis() - carT < 3000;
        float v = carFresh ? mps : gpsMps;
        if (!Float.isNaN(v)) s.append(",\"kmh\":").append(String.format(Locale.US, "%.1f", Math.abs(v) * 3.6f)).append(",\"src\":\"").append(carFresh ? "car" : "gps").append('"');
        if (!Float.isNaN(steer)) s.append(",\"steer\":").append(String.format(Locale.US, "%.1f", steer));
        if (gear != null) s.append(",\"gear\":\"").append(gear).append('"');
        if (brake != null) s.append(",\"brake\":").append(brake);
        if (turn != null) s.append(",\"turn\":").append(turn);
        if (doors != null) s.append(",\"doors\":").append(doors);
        if (uxBlock != null) s.append(",\"ux\":").append(uxBlock);
        return s.length() == 0 ? null : "{" + s.substring(1) + "}";
    }
}

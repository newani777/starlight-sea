package com.fyostudio.vecpleos;

// 차량 쪽 코드가 화면으로 값을 넘기는 유일한 길. 화면은 vec.html 의 vecCar.feed, vecSurround.feed 두 입구만 본다
public interface VecSink {
    void car(String json);        // vecCar.feed({ kmh, gear, steer, brake, turn, doors, night })
    void surround(String json);   // vecSurround.feed([{ id, kind, x, y, vx, vy }])
}

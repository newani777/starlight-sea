# 별빛 바다 (Starlight Sea)

듣고 있는 음악과 달리는 길이 밤바다의 빛이 되어 돌아오는, 차 안의 감정 공간.
차의 신호(속도·기어·핸들·브레이크·방향지시등·문)와 곡을 실시간으로 읽어 밤바다를 그리고, 화면·차의 오디오·실내 앰비언트 라이트로 내보내는 Pleos Connect 음악·오디오 앱입니다.

## ⚠️ 평가자 안내: 주행 화면은 「시연 모드」로 확인해 주세요

주행 중 화면 기준에 따라, 기어가 P가 아니고 시속 3km를 넘으면 화면 그리기를 멈추고 음악과 무드등만 이어 갑니다.
그래서 앱 목록에서 실행한 뒤 Virtual Console로 D 기어를 넣으면 **화면이 쉬는 것이 정상**입니다.
주행 중 연출은 아래 명령으로 **시연 모드**를 켜고 보시면 됩니다.

```
adb install -r apk/FYOStudio_StarlightSea_release.apk
adb shell am start -n com.fyostudio.vecpleos/.MainActivity --ez demo true
```

1. 위 둘째 줄로 앱을 켭니다(시연 모드).
2. 시작 메뉴에서 NOCTURNE · GRAND VOYAGE · 자유주행 중 하나를 고릅니다.
3. Virtual Console에서 기어를 D로 바꿉니다. 콘솔에는 속도 값이 없어 **D 기어면 시속 100km로 달리는 것으로 봅니다.** 핸들·방향지시등·문 값도 그대로 반응합니다.

| 항목 | 일반 실행(앱 목록에서) | 시연 모드(위 명령) |
|---|---|---|
| 주행 중 화면 | 멈춤, 음악과 무드등만 계속 | 계속 그림 |
| 차속 | 차량 실제 속도 | D 기어면 시속 100km로 간주 |
| 무드등 | 차량 실내등으로 출력 | 보내는 색과 밝기를 화면 왼쪽 위에도 표시(에뮬레이터는 조명을 볼 수 없음) |

정차 중 화면(녹턴의 음악 감상, 그랜드 보야지의 경로 안내, 자유주행의 바다)은 일반 실행에서도 그대로 볼 수 있습니다. 시연 모드를 끝내려면 앱을 닫고 앱 목록에서 다시 실행합니다.

## APK

- release APK: [`apk/FYOStudio_StarlightSea_release.apk`](apk/FYOStudio_StarlightSea_release.apk)
- 패키지: `com.fyostudio.vecpleos` · 버전 1.0.1 (versionCode 3)

## 실행 방법

1. Pleos Connect SDK 에뮬레이터를 켭니다(안내: https://document.pleos.ai 「Connect SDK 에뮬레이터 설치」).
2. APK를 설치합니다.
   ```
   adb install -r apk/FYOStudio_StarlightSea_release.apk
   ```
3. 앱 목록에서 「별빛 바다」를 실행합니다. 시작 화면에서 NOCTURNE · GRAND VOYAGE · ATELIER 중 하나를 고릅니다.
4. Virtual Console로 기어·브레이크·조향·방향지시등·문·무드등 값을 바꾸며 반응을 봅니다.
   - 주행 중 화면을 보려면 맨 위 「평가자 안내」의 시연 모드로 실행합니다(화면 유지·D 기어를 시속 100km로 간주):
     ```
     adb shell am start -n com.fyostudio.vecpleos/.MainActivity --ez demo true
     ```

## 테스트 환경과 필요한 설정

- Android Automotive OS, API 30 이상 (Pleos Connect)
- Pleos Vehicle SDK `ai.pleos.playground:Vehicle:2.3.2`, NaviHelper SDK `ai.pleos.playground:NaviHelper:3.0.5` (Maven: `https://nexus-playground.pleos.ai/repository/maven-releases/`)
- 권한: `pleos.car.permission.CAR_DRIVE` · `CAR_LIGHTS` · `CAR_DOORS`, `android.car.permission.CAR_SPEED`, `ACCESS_FINE_LOCATION`(차속이 없을 때 GPS 속도로 대신)
- 주행 중(기어 P가 아니고 시속 3km 초과)에는 화면 그리기를 멈추고 음악과 무드등만 이어집니다.
- 그랜드 보야지는 Pleos Connect 내비게이션의 실제 안내(NaviHelper: 다음 회전·거리·안내 문구·남은 거리·목적지)를 받아 안내판과 시선을 움직입니다. 에뮬레이터 내비 앱에서 목적지를 검색해 길 안내를 시작한 뒤 앱을 열면 확인할 수 있습니다. 안내가 없으면 시연 경로(광화문 → 현대자동차 본사)로 달립니다.
- 주변 차량·보행자는 시연용 시뮬레이션 값입니다.

## 웹 시연판

크롬 데스크톱: https://star-drive-proto.vercel.app/vec.html?pc=1
조작: W 가속 · S 브레이크 · A/D 조향 · 마우스 시점

## 소스 구성

| 파일 | 역할 |
|---|---|
| `app/src/main/java/.../MainActivity.java` | WebView 화면(WebViewAssetLoader), 시연 모드 |
| `CarBridge.java` | AAOS 차량 속성(속도 등) → 화면 |
| `PleosBridge.java` | Pleos Vehicle SDK 구독(기어·핸들·브레이크·방향지시등·문), 앰비언트 라이트 색·밝기 설정과 복원 |
| `NaviBridge.java` | Pleos NaviHelper SDK: 실제 내비 안내 수신 → 그랜드 보야지 안내판·시선 |
| `VecMediaService.java` · `VecMedia.java` | MediaBrowserService·MediaSession: 백그라운드 재생, 핸들 미디어 버튼, 오디오 포커스 |
| `NowPlayingWatch.java` | 스트리밍 곡 정보 연결점(현재 꺼 둠) |
| `app/src/main/assets/www/` | 화면(WebGL)·연출 스크립트·내장 곡 |

## 출처와 라이선스

별자리 자료(D3-Celestial, BSD 3-Clause)·별자리 설명(Astronomer's Atlas API)·경로 지도 데이터(© OpenStreetMap contributors, ODbL)를 씁니다. 원문 고지는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.

## 빌드

```
gradlew assembleRelease -Ppublic=true
```
`-Ppublic=true` 는 로컬 시험용 음원(`assets/www/_local`)을 APK에서 뺍니다. release 서명 열쇠는 저장소에 넣지 않습니다.

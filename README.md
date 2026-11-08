# 별빛 바다 (Starlight Sea)

듣고 있는 음악과 달리는 길이 밤바다의 빛이 되어 돌아오는, 차 안의 감정 공간.
차의 신호(속도·기어·핸들·브레이크·방향지시등·문)와 곡을 실시간으로 읽어 밤바다를 그리고, 화면·차의 오디오·실내 앰비언트 라이트로 내보내는 Pleos Connect 음악·오디오 앱입니다.

## APK

- release APK: [`apk/FYOStudio_StarlightSea_release.apk`](apk/FYOStudio_StarlightSea_release.apk)
- 패키지: `com.fyostudio.vecpleos` · 버전 1.0 (versionCode 2)

## 실행 방법

1. Pleos Connect SDK 에뮬레이터를 켭니다(안내: https://document.pleos.ai 「Connect SDK 에뮬레이터 설치」).
2. APK를 설치합니다.
   ```
   adb install -r apk/FYOStudio_StarlightSea_release.apk
   ```
3. 앱 목록에서 「별빛 바다」를 실행합니다. 시작 화면에서 NOCTURNE · GRAND VOYAGE · ATELIER 중 하나를 고릅니다.
4. Virtual Console로 기어·브레이크·조향·방향지시등·문·무드등 값을 바꾸며 반응을 봅니다.
   - 발표용 시연 모드(화면 유지·교통 시뮬레이션·D 기어를 시속 100km로 간주):
     ```
     adb shell am start -n com.fyostudio.vecpleos/.MainActivity --ez demo true
     ```

## 테스트 환경과 필요한 설정

- Android Automotive OS, API 30 이상 (Pleos Connect)
- Pleos Vehicle SDK `ai.pleos.playground:Vehicle:2.3.2` (Maven: `https://nexus-playground.pleos.ai/repository/maven-releases/`)
- 권한: `pleos.car.permission.CAR_DRIVE` · `CAR_LIGHTS` · `CAR_DOORS`, `android.car.permission.CAR_SPEED`, `ACCESS_FINE_LOCATION`(차속이 없을 때 GPS 속도로 대신)
- 주행 중(기어 P가 아니고 시속 3km 초과)에는 화면 그리기를 멈추고 음악과 무드등만 이어집니다.
- 주변 차량·보행자와 경로 주행은 시연용 시뮬레이션 값입니다.

## 웹 시연판

크롬 데스크톱: https://star-drive-proto.vercel.app/vec.html?pc=1
조작: W 가속 · S 브레이크 · A/D 조향 · 마우스 시점

## 소스 구성

| 파일 | 역할 |
|---|---|
| `app/src/main/java/.../MainActivity.java` | WebView 화면(WebViewAssetLoader), 시연 모드 |
| `CarBridge.java` | AAOS 차량 속성(속도 등) → 화면 |
| `PleosBridge.java` | Pleos Vehicle SDK 구독(기어·핸들·브레이크·방향지시등·문), 앰비언트 라이트 색·밝기 설정과 복원 |
| `VecMediaService.java` · `VecMedia.java` | MediaBrowserService·MediaSession: 백그라운드 재생, 핸들 미디어 버튼, 오디오 포커스 |
| `NowPlayingWatch.java` | 스트리밍 곡 정보 연결점(현재 꺼 둠) |
| `app/src/main/assets/www/` | 화면(WebGL)·연출 스크립트·내장 곡 |

## 빌드

```
gradlew assembleRelease -Ppublic=true
```
`-Ppublic=true` 는 로컬 시험용 음원(`assets/www/_local`)을 APK에서 뺍니다. release 서명 열쇠는 저장소에 넣지 않습니다.

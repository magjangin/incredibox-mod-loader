# Incredibox ModLoader

**Incredibox PC(Steam) 버전용 모드 로더**입니다.
게임 코드를 고치지 않고 JS/CSS 모드를 주입하고, 안드로이드용 모드 APK(100캐릭터 / 10폴로)를 PC에서 그대로 실행할 수 있게 해 줍니다.

> ⚠️ 이 저장소에는 게임 파일이 들어 있지 않습니다. Steam에서 구매한 정품 Incredibox가 필요합니다.
> 비공식 팬 프로젝트이며 So Far So Good(Incredibox 제작사)과 관련이 없습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🧩 JS/CSS 모드 | `Mods/<모드>/mod.json`만 만들면 렌더러에 스크립트·스타일 주입, 메인 프로세스 스크립트도 지원 |
| 📱 안드로이드 모드 APK 실행 | APK의 웹 에셋을 풀어서 PC에서 실행 — 100캐릭터 아이콘을 20×5 격자로 자동 배치, 화면 배율 조절 |
| 🎛️ F10 오버레이 | 설치된 모드 목록·상태·에러 표시, APK 모드 실행(Play) / PC판 복귀 |
| 🛠️ 개발 도구 | `F12` 또는 `Ctrl+Shift+I`로 DevTools, `Mods/modloader.log` 로그 (이전 실행은 `modloader.prev.log`) |
| ⚡ 빠른 실행 | 204MB 자체 압축 해제를 매번 하지 않도록 `Modded\` 폴더에 한 번만 풀어 둠 |

## 요구 사항

- Windows + **Incredibox (Steam, v1.2.9에서 확인)**
- [Node.js](https://nodejs.org/) 18 이상
- [Bandizip](https://www.bandisoft.com/bandizip/) (`bz.exe` — 게임 실행 파일 안의 7z/NSIS 압축을 푸는 데 사용)

## 설치

```powershell
git clone https://github.com/magjangin/incredibox-mod-loader.git
cd incredibox-mod-loader
powershell -ExecutionPolicy Bypass -File scripts\setup-game.ps1
```

- Steam 라이브러리에서 Incredibox 설치 경로를, Program Files/PATH에서 Bandizip을 **자동으로 찾습니다.**
- 못 찾으면 직접 지정하세요: `-GameDir "<설치 경로>"`, `-Bandizip "<bz.exe 경로>"`, `-TargetDir "<풀 위치>"` (기본값 `<GameDir>\Modded`)

설치가 끝나면 **`<GameDir>\Modded\Incredibox.exe`** 로 실행합니다. 원본 `Incredibox_steam.exe`는 건드리지 않습니다.
왼쪽 아래에 `ModLoader v0.2.0 (… JS, … APK) [F10]` 배지가 보이면 성공입니다.

## 단축키

| 키 | 동작 |
| --- | --- |
| `F10` (또는 배지 클릭) | 모드 오버레이 열기/닫기 |
| `F12` / `Ctrl+Shift+I` | DevTools |

## 모드 만들기

`<GameDir>\Modded\Mods\my-mod\mod.json`:

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "author": "you",
  "description": "무엇을 하는 모드인지",
  "renderer": "renderer.js",
  "css": "style.css",
  "main": "main.js",
  "enabled": true
}
```

| 필드 | 실행 위치 | 설명 |
| --- | --- | --- |
| `renderer` | 게임 페이지 | `ModLoader`(API), `mod`(메타데이터) 두 인자를 받는 스크립트 본문 |
| `css` | 게임 페이지 | `<style>` 태그로 주입 |
| `main` | Electron 메인 프로세스 | `require`됨. 함수를 export하면 `{ app, BrowserWindow, ipcMain, logger, mod, loaderVersion }` 전달 |
| `enabled` | — | `false`면 건너뜀. 폴더 이름이 `.`/`_`로 시작해도 건너뜀 |

```js
// renderer.js
ModLoader.log(mod.id, '안녕하세요!');
```

렌더러 API (`window.IncrediboxModLoader`): `version`, `mods`, `apkMods`, `isApkMode`, `log(modId, ...args)`, `launchApkMod(id)`, `backToPc()`, `toggleOverlay()`

예제: [`mods-example/hello-mod`](mods-example/hello-mod)

## 안드로이드 모드 APK

PC판은 아이콘 20개·폴로 7명이 고정이라 100캐릭터 모드가 그대로 돌아가지 않습니다. APK의 웹 엔진째로 풀어서 실행합니다.

```powershell
node scripts\unpack-apk-mod.js "C:\path\to\mod.apk"
```

`Modded\ApkMods\<모드 이름>\`에 풀리고, 게임에서 `F10` → **Play**로 실행합니다. 오버레이의 `-`/`+`로 화면 배율 조절, **Back to PC Incredibox**로 복귀합니다.

> 참고: 이 스크립트는 녹음 길이 제한(`recmaxloop`)을 999 루프로 늘리고 안드로이드 전용 `cordova.js`를 비활성화합니다.

PC판 기본 모드 슬롯(20캐릭터)으로 가져오려면 `node scripts\import-apk.js "<mod.apk>"` 를 사용하세요 (`%APPDATA%\Incredibox\incredimods\`에 등록).

## 동작 원리

```
Incredibox_steam.exe (NSIS) ─▶ app-64.7z ─▶ Modded\Incredibox.exe + resources\app.asar
                                                         │ extract-asar.js
                                                         ▼
                                   resources\app\package.json  "main": "modloader/main.js"
                                                         │
modloader/main.js ── Mods/·ApkMods/ 스캔, 로그, DevTools 단축키, Steam 실행 인자 보정
        │           dom-ready 때 renderer.js + 모드 코드 주입
        └─▶ require('../src/elec-index.js')   (원래 게임 시작)
```

자세한 설계 의도와 주의 사항은 [AGENTS.md](AGENTS.md)를 참고하세요.

## 프로젝트 구조

```
modloader/        메인 프로세스 부트스트랩(main.js), 렌더러 API·오버레이(renderer.js)
scripts/          setup-game.ps1, extract-asar.js, unpack-apk-mod.js, import-apk.js, lib/common.js
mods-example/     샘플 모드
```

## 문제 해결

- **배지가 안 보임** → `Modded\Mods\modloader.log` 확인, `Modded\Incredibox.exe`로 실행했는지 확인
- **Incredibox/Bandizip을 못 찾음** → `-GameDir`, `-Bandizip` 인자 또는 환경변수 `INCREDIBOX_DIR`, `BANDIZIP` 지정
- **게임 업데이트 후 동작 안 함** → `setup-game.ps1`을 다시 실행 (Modded 폴더를 새로 풀고 로더를 다시 설치)

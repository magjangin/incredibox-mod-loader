# Incredibox ModLoader

Incredibox PC(Steam, v1.2.9, Electron)용 모드 로더입니다.

- `Mods/` 폴더의 JS/CSS 모드를 게임 렌더러에 주입
- F12 / Ctrl+Shift+I 로 DevTools, F10 으로 모드 목록 오버레이
- 안드로이드 모드 APK를 풀어서 PC에서 실행 (100캐릭터 / 10폴로 레이아웃 지원)

> 게임 파일은 이 저장소에 포함되지 않습니다. 정품 Steam 설치본이 필요합니다.

## 요구 사항
- Incredibox (Steam)
- [Node.js](https://nodejs.org/)
- [Bandizip](https://www.bandisoft.com/bandizip/) (`bz.exe`)

## 설치
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-game.ps1 -GameDir "<Incredibox 설치 경로>" -TargetDir "<Incredibox 설치 경로>\Modded"
```
`<TargetDir>\Incredibox.exe` 로 실행합니다.

## 모드 만들기
`Mods/<모드폴더>/mod.json`:
```json
{
  "id": "hello-mod",
  "name": "Hello Incredibox",
  "version": "1.0.0",
  "renderer": "renderer.js",
  "css": "style.css",
  "main": "main.js",
  "enabled": true
}
```
- `renderer`: 렌더러에서 실행. `ModLoader`(API), `mod`(정보) 두 인자를 받습니다.
- `css`: 페이지에 `<style>`로 주입.
- `main`: 메인 프로세스에서 `require`. 함수를 export하면 `{ app, BrowserWindow, ipcMain, logger, mod }`를 받습니다.

예제는 [`mods-example/hello-mod`](mods-example/hello-mod)를 참고하세요.

## 안드로이드 모드 APK
```powershell
node scripts\unpack-apk-mod.js "<mod.apk>" "<GameDir>\Modded"
```
게임에서 F10 → Play 로 실행합니다.

자세한 내부 구조는 [AGENTS.md](AGENTS.md)를 참고하세요.

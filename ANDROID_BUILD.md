# Building the Android APK

The React app is the frontend that runs **inside** the native Android shell (a Capacitor WebView). The `android/` project is now committed, so you only need Android Studio + JDK 17 on your PC to produce an APK.

## Prerequisites (one-time)
1. Install **Android Studio** (https://developer.android.com/studio) — it bundles the required JDK and SDK manager.
2. In Android Studio → Settings → SDK Manager, make sure **Android SDK Platform 34+** and **Build-Tools** are installed.

## Steps
```bash
cd app
npm install            # installs @capacitor/android among others
npm run build          # produces dist/ (the React frontend)
npx cap sync android   # copies dist/ into android/app/src/main/assets/public
```
Then either:
- **Open in Android Studio:** `npx cap open android` → Run ▶ on a connected phone/emulator, or
- **Build APK from terminal:**
  ```bash
  cd android
  gradlew assembleDebug        # Windows: .\gradlew assembleDebug
  ```
  APK appears at `android/app/build/outputs/apk/debug/app-debug.apk` — copy to your phone and install (allow "Install unknown apps").

## After changing any code
```bash
cd app && npm run build && npx cap sync android
```
(then rebuild in Android Studio, or run gradlew again). Native plugins already wired: LocalNotifications (reminders) and Browser (Gmail OAuth login).

## Release build (Play Store / clean signing)
Create a keystore (`keytool -genkey ...`) and configure `android/app/signing.properties`, then `gradlew assembleRelease`. See https://capacitorjs.com/docs/android/building for details.

# Release APK for friends (Path 1: direct sharing)

Build a **release-signed** APK once, then send it to friends over WhatsApp/Drive/email.
No Play Store, no servers, no verification needed. Friends just enable
"Install unknown apps" and open the file.

## One-time setup (on your PC)

### 1. Create your keystore (this is your app's identity — back it up!)
```bash
cd android
keytool -genkeypair -v -keystore attendancetracker.keystore -alias attendancetracker \
  -keyalg RSA -keysize 2048 -validity 10000
```
- Runs from `android/` so the keystore sits OUTSIDE the repo folder tree if you prefer;
  the default `signing.properties.example` expects it at `android/attendancetracker.keystore`.
- Pick strong passwords and **write them down somewhere safe**. If you lose this keystore,
  friends can never install updates over the old version (they'd have to uninstall + lose data).

### 2. Tell Gradle where the keystore is
```bash
cp app/signing.properties.example app/signing.properties
# then edit app/signing.properties with your real passwords
```

Both files are gitignored — never commit them.

## Build the APK

From the `app/` folder (repo root of the web app):
```bash
npm run build            # produces dist/
npx cap sync android     # copies dist/ into the Android project
cd android
./gradlew assembleRelease    # Windows: .\gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/attendance-tracker-1.1-release.apk`

Since `signing.properties` exists, Gradle signs it with YOUR key automatically —
no Android Studio needed.

## Send to friends
1. Transfer the `.apk` file (WhatsApp / Google Drive link / email).
2. On their phone: tap the file → allow "Install unknown apps" for that app → Install.
3. First launch may show an "untrusted developer" warning — that's normal for
   sideloaded APKs; there is nothing to verify or pay.

## Shipping updates later
1. Bump BOTH numbers in `android/app/build.gradle`:
   ```groovy
   versionCode 3          // must increase every release
   versionName "1.2"      // what users see
   ```
2. Rebuild (`npm run build && npx cap sync android && ./gradlew assembleRelease`).
3. Send the new APK. Because it's signed with the same keystore, friends install it
   **over** the old one — all attendance/timetable data is preserved. No uninstall needed.

## Safety notes
- Keep `attendancetracker.keystore` + `signing.properties` backed up (e.g. encrypted cloud).
  Losing them = losing the ability to update the app in place forever.
- Don't share the keystore or passwords with anyone; they could publish "your" app.
- If you ever distribute without a keystore yet, the build falls back to debug signing —
  fine for testing, but switch to your real keystore BEFORE sending to friends
  (debug-signed installs can't be upgraded to your release signature without uninstalling).

# Gmail Integration Setup Guide

The Attendance Tracker can connect directly to your college email (Gmail) to
automatically detect deadlines, exam dates and notices from incoming messages.
Detected items appear as **suggestions** that you can accept (they become
reminders/deadlines) or dismiss. If you don't want to connect an account, the
**paste-box fallback** works with zero setup — just copy any email text into
*Reminders → Paste*.

Live connection uses OAuth 2.0 Authorization Code + PKCE (no backend server
needed) and the Gmail REST API with read-only permission. Tokens are stored
encrypted at rest in the app's local storage.

---

## What the app needs from you

A single value: a **Google Cloud OAuth Client ID**. You create it once, in
about 5 minutes, following the steps below. The app never asks for your
password — Google handles sign-in in its own page.

---

## Android app (recommended): native sign-in

The Android app signs in with the phone's Google account picker (Google Play
Services) — there is **no Client ID to paste** and no redirect URI.

1. <https://console.cloud.google.com/> → create a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **OAuth consent screen** → External → app name + your email → under
   **Test users** add the Gmail address you will connect.
4. **Credentials → Create credentials → OAuth client ID** → type **Android**:
   - Package name: `com.attendancetracker.app`
   - SHA-1: the fingerprint of the key the installed APK was signed with.
     The app shows it (with a copy button) in **Settings → Deadlines & email →
     College email**. For your own keystore:
     `keytool -list -v -keystore attendancetracker.keystore -alias attendancetracker`
5. In the app: **Connect Gmail & fetch** → pick the account → allow read-only
   access. The app then checks mail on open (at most every 6 hours) and
   notifies you about new deadlines.

Code: `android/app/src/main/java/com/attendancetracker/app/GmailAuthPlugin.java`
(native) and `app/src/logic/gmailNative.ts` (bridge).

| Android symptom | Fix |
|---|---|
| "Google doesn't recognise this app yet" (code 10) | The Android OAuth client is missing, or its package name / SHA-1 doesn't match the installed APK. |
| Sign-in works but access is denied | Add the account under **Test users** on the consent screen. |
| Asked to sign in again after ~a week | Expected while the Google project is in "Testing". |

---

## Web build: step-by-step setup

### 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and sign in with **any** Google
   account (it does not have to be your college one).
2. Tap the project selector (top bar) → **New Project**.
3. Name it e.g. `attendance-tracker` → **Create**, then select it.

### 2. Enable the Gmail API
1. Left menu → **APIs & Services → Library**.
2. Search for **Gmail API** → open it → **Enable**.

### 3. Configure the OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. User type: **External** → Create.
3. Fill in the app name (e.g. *Attendance Tracker*) and your support email.
4. Scopes: leave default; the app only requests
   `https://www.googleapis.com/auth/gmail.readonly`.
5. **Test users**: add the email address you will connect in the app
   (your college Gmail). ⚠️ While the app is in "Testing" status, ONLY test
   users can sign in — skipping this causes a `403 access_denied` error.
6. Save.

### 4. Create the OAuth Client ID
1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add the exact URI shown by the app in
   *Settings → College email* (it is displayed next to the Client ID field).
   Examples:
   - Local dev: `http://localhost:5173/` (or `:5174/` if 5173 was busy —
     use exactly what the app shows)
   - Hosted web build: `https://your-domain/`
   - Android (Capacitor): `io.attendancetracker.app://callback`
4. **Create** → copy the **Client ID** (the long string ending in
   `.apps.googleusercontent.com`). No secret is needed — PKCE replaces it.

### 5. Connect inside the app
1. Open the app → **Settings → College email**.
2. Paste the Client ID → **Save**. The app shows the redirect URI to register.
3. Tap **Connect email** → sign in with your college account → allow access.
4. Use **Fetch now** (or let the app fetch on launch) to scan recent mail.
   New suggestions appear under Reminders and on the Today screen.
5. **Disconnect** anytime — this wipes the stored tokens from the device.

---

## Running locally (development)

```bash
git clone https://github.com/Pranno/AttendaceTracker.git
cd AttendaceTracker/app
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173/`) and make sure
that exact origin+path is registered as an Authorized redirect URI in step 4.

## How it works under the hood

- `app/src/logic/gmail.ts` — PKCE flow, token refresh, inbox fetch + parse
- `app/src/logic/tokenCrypto.ts` — AES-GCM encryption of tokens at rest
- `app/src/components/EmailInbox.tsx` — Connect / Fetch / Disconnect UI,
  with the paste box as fallback
- Suggestion accept/dismiss actions live in `app/src/data/store.tsx`

## Troubleshooting

| Symptom | Fix |
|---|---|
| `403 access_denied` after sign-in | Your email isn't listed as a **test user** (step 3.5), or consent screen misconfigured. |
| `redirect_uri_mismatch` | The URI registered in Google Console differs from the one the app displays. Copy it exactly (trailing slash matters). |
| Popup blocked | Allow popups for the app's origin, or use the full-page sign-in option. |
| Nothing detected | The parser looks for date/deadline keywords in message bodies. Notices written as images/PDF attachments aren't parsed — use the paste fallback for those. |
| Token lost after reinstall | Reconnect; tokens are device-local only. |

## Privacy notes

- The app reads **only** messages from your account, on-device, with
  read-only scope. Nothing is sent to any third-party server — mail goes
  straight from Google's API to your browser/app.
- Only extracted titles/dates become suggestions; full message bodies are
  not persisted.
- To revoke access later: Google Account → Security → Third-party apps →
  remove *Attendance Tracker*, plus **Disconnect** in app Settings.

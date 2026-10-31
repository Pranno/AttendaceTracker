# 📅 Attendance Tracker

A personal, offline-first attendance tracker for college students. Upload your timetable, set your target attendance percentage, and the app does the math — how many classes you can safely bunk, which subjects are at risk, and what your month-end attendance will look like.

Built with **React + Vite + TypeScript**, wrapped as a native Android app with **Capacitor**. All data stays on your device. Optional Gmail integration (OAuth, user-initiated only) extracts assignment deadlines from your inbox.

## ✨ Features

- **Timetable import** — PDF / CSV parser for structured college timetables, plus a manual editor with smart day-chip lecture entry (tap a highlighted day to toggle it off).
- **Attendance math** — per-subject %, bunk calculator ("how many can I miss?"), must-attend warnings against your threshold (default 75%). Lab double-periods count as one session.
- **Today & Calendar** — sticky day strip, month view with scheduled lectures, swipe between tabs with gesture guards that never fire on buttons or horizontal scrollers.
- **Study module** — course cards, marks entry per subject, CGPA planner (target ↔ required-marks projection).
- **Reminders** — local notifications for low-attendance subjects; deadline extraction from Gmail or a paste box.
- **Monthly projection** — forecast of where your attendance lands by month-end if current pace continues.

## 📱 Install (Android)

1. Grab the latest `attendance-tracker-*-release.apk` (share link / GitHub Releases).
2. Open it on your phone → allow "Install unknown apps" → done.
3. Build it yourself: see [ANDROID_BUILD.md](ANDROID_BUILD.md).

## 🧱 Project layout

```
app/                 Capacitor + Vite app
  src/logic/         pure business logic (attendance, projection, parsers) + unit tests
  src/components/    screens (Today, Timetable, Study, Settings…)
  src/data/          storage + state store
  android/           native wrapper (release signing via gitignored signing.properties)
docs/                REQUIREMENTS.md (feature matrix) · PROGRESS.md (changelog)
GMAIL_SETUP.md       step-by-step Google OAuth setup
```

## 🚀 Run locally

```bash
cd app
npm install
npm run dev        # web preview at localhost:5173
npm test           # vitest unit tests
npm run build      # production web bundle
```

## 🔒 Privacy

No backend, no accounts, no analytics. Attendance data lives in IndexedDB/localStorage on your phone. The only network access is the Gmail fetch you explicitly authorize; the OAuth token is encrypted at rest.

## 📄 Status

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the full feature matrix and [docs/PROGRESS.md](docs/PROGRESS.md) for what's done and what's next.

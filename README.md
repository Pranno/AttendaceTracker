# 📅 Attendance Tracker

A personal, offline-first attendance tracker for college students. Import your timetable, mark classes as you go, and the app does the maths — your percentage in every subject, how many classes you can still skip, what you must attend this month, and every deadline and holiday from your college messages.

Built with **React + Vite + TypeScript**, wrapped as a native Android app with **Capacitor 6**. No backend and no account: all data stays on the phone.

## ✨ Features

**Attendance**
- Per-subject percentage, "can skip" / "must attend" numbers and a monthly plan to the semester end.
- Count the whole semester (unmarked past classes assumed at a set %) or only from the day you start; optional "unmarked = present".
- Holidays, exam days, cancelled / no-class marks, teacher swaps ("converted" lectures), 2-period labs counted once, per-batch filtering, ERP totals override, per-subject targets.

**Timetable & syllabus**
- Timetable import from the college PDF with the offline **Standard** reader (grid parser, verified class-for-class against real division PDFs) or **Smart (AI)** — Google Gemini with the user's own free API key; or add classes by hand.
- Syllabus import (Smart): every unit and topic, outcomes, practicals, books and links — shown per subject; course links go straight into the subject's Locker.

**Deadlines, holidays & email**
- Paste a college message: deadlines of every kind (exams, submissions, registrations, forms, fees…) and holiday notices are picked out by the Standard reader or Smart AI.
- Gmail: native Google sign-in in the Android app (read-only); new deadlines arrive as suggestions with a notification.
- All deadlines in one list (Overdue · Today · This week · Later), reminders before each due date, evening "mark your attendance" nudge and a "tomorrow's classes" preview.

**Locker** — per subject: notes (shown in full, chat-style), files (PDFs and photos open in the app; other files open in another app or share) and course links with completion ticks.

**Also** — first-run setup + tour, CGPA planner, export / restore backup, semester archive, light / dark themes.

## 📱 Install (Android)

1. Get the latest `attendance-tracker-<version>-release.apk`.
2. Open it on the phone → allow "Install unknown apps".
3. Build it yourself: [ANDROID_BUILD.md](ANDROID_BUILD.md) · signed releases: [app/android/RELEASE_APK.md](app/android/RELEASE_APK.md).

Optional setup: Gmail — [GMAIL_SETUP.md](GMAIL_SETUP.md); Smart (AI) import — in the app, Settings → Smart import (AI) has a step-by-step guide.

## 🧱 Project layout

```
app/
  src/logic/          pure logic + unit tests: attendance, projection, timetable parser,
                      deadline / holiday readers, Gemini client, Gmail, file storage
  src/logic/__fixtures__/  real timetable PDFs extracted as pdf.js text (parser tests)
  src/components/     screens: Today, Subjects, Timetable, Calendar, Locker, Settings, Onboarding…
  src/data/           data model, local storage (+ repairs for older saves), state store
  samples/            sample division timetable PDFs (source of the fixtures)
  scripts/            extract-tt-pages.mjs — regenerate a fixture from a PDF
  android/            native project; GmailAuthPlugin.java = native Gmail sign-in
docs/                 REQUIREMENTS.md (feature matrix) · PROGRESS.md (changelog)
```

## 🚀 Develop

```bash
cd app
npm install
npm run dev        # web preview at localhost:5173
npm test           # vitest — logic, store and end-to-end import tests
npm run build      # type-check + production web bundle
```

Every push and pull request runs the tests, type-check and build on GitHub Actions (`.github/workflows/ci.yml`).

## 🔒 Privacy

No backend, no accounts, no analytics. Data lives in the phone's local storage (files in IndexedDB). Network access only happens for features you turn on: Gmail (read-only, your own Google Cloud project) and Smart (AI) import (your own Gemini key, kept on the phone and never included in backups).

## 📄 Status

[docs/PROGRESS.md](docs/PROGRESS.md) — what's done and what's next.

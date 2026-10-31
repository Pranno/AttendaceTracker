# Progress

Chronological log of what has been built. Newest first. See [REQUIREMENTS.md](REQUIREMENTS.md) for the feature matrix and current gaps.

## 2026-10-31 — Repo cleanup & docs
- Removed scratch files (raw requirement dumps, extraction scripts), sample timetable/syllabus uploads from history-tracked paths.
- Added `docs/REQUIREMENTS.md` (feature matrix with per-item status) and this progress doc.
- Verified: TypeScript compiles clean, `vite build` succeeds.

## 2026-10-31 — Native feel + Today screen fixes
- Removed duplicate timetable header.
- Sticky day strip on Today screen — only content below it scrolls vertically now.
- Removed Subjects section from Today (dedicated Subjects tab is the single source).
- Status-bar tinting via Capacitor; disabled pinch-zoom, browser bounce, tap highlights/text selection.

## 2026-10-31 — Swipe between tabs
- Horizontal swipe anywhere on screen switches main tabs (Today → Subjects → …).
- Gesture guards: vertical scrolling wins over swipes; horizontal scrollers (day strip) consume their own gestures; buttons/inputs/interactive controls never trigger tab changes.

## 2026-10-31 — Android release APK pipeline (Path 1 distribution)
- Release signing wired in `android/app/build.gradle` via gitignored `signing.properties` (falls back to debug signing if absent).
- Keystore generation guide (`android/RELEASE_APK.md`), output renamed `attendance-tracker-<version>-release.apk`.
- Bumped versionCode 2 / versionName 1.1. First shareable signed APK built and installed successfully on device.

## 2026-10-30 — Lecture day-picker rework
- Unified "Days" chip row when adding a lecture: selected days highlighted live.
- Duplicate-aware: days that already contain the lecture are marked (green ✓); tapping one removes the lecture from that day (history-safe removal for past slots, hard delete for future).
- Guards against accidental double-adds.

## 2026-10-30 — Study screen components
- Course cards per subject (`CourseParts.tsx`).
- Marks entry/display panel (`MarksPanel.tsx`).
- CGPA planner (`CgpaPlanner.tsx`) reusing study/attendance logic.
- Wired into `Study.tsx`, store, styles.

## Earlier milestones
- Timetable PDF + CSV import with parser tests.
- Attendance math: per-subject %, bunk calculator, must-attend warnings; lab double-periods count as one session.
- Month calendar view with scheduled lectures.
- Paste-box deadline extraction + Gmail OAuth inbox integration (token encrypted at rest).
- Monthly projection card.
- Local notifications for low attendance.

## Known gaps / next up
| Item | Ref | Notes |
|------|-----|-------|
| Excel (.xlsx) timetable import UI | A3 | dependency present, needs file-input wiring |
| Syllabus upload UI | E2 | parser exists, no interface yet |
| Week view | C3 | |
| Per-subject custom reminder times | D8 | |
| Permission-status display in Settings | F6 | |

# Attendance Tracker — Requirements

Personal attendance tracker: upload your timetable and your target attendance percentage, and the app does the math for you — how many classes you can safely bunk, what happens if you attend/skip upcoming lectures, and reminders so you never drop below your threshold.

Data stays on-device (IndexedDB / localStorage). Optional Gmail integration reads deadline/notice emails with user consent. No backend, no accounts, no tracking.

---

## A. Timetable

| ID | Requirement | Status |
|----|-------------|--------|
| A1 | Import timetable from PDF (structured college tables) | ✅ Done |
| A2 | Import timetable from CSV | ✅ Done |
| A3 | Import timetable from Excel (.xlsx) | ⚠️ Dependency installed, UI not wired |
| A4 | Manual timetable editor (add/edit/remove lecture slots per day) | ✅ Done |
| A5 | Lecture entry day-picker: selected days highlighted; tapping a day that already has this lecture removes it from that day (no need to delete + re-add) | ✅ Done |
| A6 | Lab/practical double-periods count as ONE session (college rule) | ✅ Done |
| A7 | Recurring weekly schedule drives "Today" and calendar automatically | ✅ Done |

## B. Attendance Calculation

| ID | Requirement | Status |
|----|-------------|--------|
| B1 | Per-subject attendance % from attended/conducted counts | ✅ Done |
| B2 | Mark lectures attended/skipped from Today screen or week view | ✅ Done |
| B3 | Target threshold per subject (default 75%) | ✅ Done |
| B4 | "Bunk calculator": how many future classes can be missed while staying ≥ target | ✅ Done |
| B5 | "Must-attend" warning when below/at risk of threshold | ✅ Done |
| B6 | What-if planner (simulate attending/skipping N classes) | ❌ Not required (dropped) |

## C. Calendar & Views

| ID | Requirement | Status |
|----|-------------|--------|
| C1 | Month calendar with scheduled lectures marked | ✅ Done |
| C2 | Day strip on Today screen (sticky; only content below scrolls) | ✅ Done |
| C3 | Week view | ❌ Pending |
| C4 | Swipe left/right between main tabs anywhere on screen, with guards so horizontal scrollers (day strip), buttons, inputs, and vertical scroll never trigger a tab change | ✅ Done |

## D. Reminders & Notifications

| ID | Requirement | Status |
|----|-------------|--------|
| D1 | Local notifications for low-attendance subjects | ✅ Done |
| D2 | Deadline reminders parsed from Gmail (paste box + inbox extraction) | ✅ Done |
| D3 | Monthly projection card (end-of-month attendance forecast) | ✅ Done |
| D4 | Notification permission handling on Android | ✅ Done |
| D8 | Custom reminder times per subject | ❌ Pending |

## E. Study Module

| ID | Requirement | Status |
|----|-------------|--------|
| E1 | Course cards per subject (CourseParts) | ✅ Done |
| E2 | Syllabus upload + parsing | ⚠️ Parser exists (`syllabusReader.ts`), no upload UI |
| E5 | Marks entry & display per subject (MarksPanel) | ✅ Done |
| E11 | CGPA planner (target ↔ required marks projection) | ✅ Done |
| E-ai | AI tutor | ❌ Out of scope |

## F. Settings & Platform

| ID | Requirement | Status |
|----|-------------|--------|
| F1 | Gmail OAuth connect/disconnect (token encrypted at rest) | ✅ Done |
| F2 | Paste-box manual extraction of deadlines from email text | ✅ Done |
| F3 | Native-feel shell: status-bar tinting, no pinch-zoom/browser bounce, no tap highlights | ✅ Done |
| F4 | Release-signed APK distribution (share via Drive/WhatsApp, install over old versions) | ✅ Done |
| F6 | Permission-status display in settings | ❌ Pending |

## Non-functional

- **Offline-first:** all core features work without network.
- **Privacy:** data never leaves the device except explicit Gmail fetch initiated by the user.
- **Tests:** logic layer covered by Vitest unit tests (attendance, projection, deadlines, timetable import, storage).

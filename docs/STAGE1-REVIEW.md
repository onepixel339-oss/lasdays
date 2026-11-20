# Stage 1 Review — Backup, Restore & Offline (Phase 2 + Phase 3)

Independent verification of Stage 1 (the "Complete Backup, Restoration & Offline
Experience" stage of the transformation roadmap), performed after implementation
and before the Stage 2 design work.

## 1. What was verified, and how

| Area | Evidence |
| --- | --- |
| Backup export completeness | `tests/backup.test.ts` — export includes profile, settings, and all 8 data tables (tasks, notes, sprints, sessions, exams, decks, cards, reviewLogs) with images and correct counts |
| Full restore round-trip | Wipe device → replace-import → every record, ID, deck relation, card image, review log and setting identical to the export |
| Merge semantics | New records added; conflicts resolved: task completion never regresses, notes newest-`updatedAt` wins, cards keep the record with more reviews (SRS progress), sprint `donePages` takes the max, review history is append-only |
| Replace semantics | Safety backup of pre-replace data taken and reported before any wipe; profile and settings restored; signed-in state restored |
| Legacy v2 | v2 files (wrapped and plain-array shapes) normalize and import with IDs preserved; missing IDs/defaults are filled like the old importer |
| Invalid backup rejection | Non-JSON, wrong app marker, unknown format, duplicate ids, malformed fields, non-data-URL images — all rejected; database untouched on rejection |
| Duplicate/conflict detection | Same-id differing records counted as conflicts in the per-table report; duplicates within a file are a validation error |
| Orphan handling | Cards referencing a missing deck are skipped and reported; review logs referencing unknown cards import as history with a warning |
| Offline navigation | Live Chromium session with network cut: navigated to /tasks, /srs, /quran, /settings — all render from the service-worker shell |
| Offline reload | Reloaded /settings while fully offline — page, session (profile from IndexedDB) and the "مراجعة الفيزياء" task all intact |
| Offline data creation | Created a deck ("ديك التاريخ") while offline; task created while online persisted through offline reload |
| Quran audio online-only | Player guards playback with `navigator.onLine`; offline UI shows the internet-required notice with retry; SW bypasses radiojar/quranicaudio//api/radio and any non-sounds audio destination; runtime cache audit: **0** Quran/API/mp3 entries across 126 cached requests |
| Quran zero persistence | `preload="none"` always; player never touches Cache Storage/IndexedDB/localStorage (asserted by test); no Quran audio in precache, backups, or PWA assets |
| Ambience stays offline | /sounds/* cache-first in SW (explicitly allowed) |
| Service worker updates | Consent-based: new SW waits, page shows update banner, reload posts SKIP_WAITING; activation deletes only non-current `ld-*` caches — IndexedDB is never opened by the SW |
| IndexedDB preservation across updates | SW code contains no IndexedDB/localStorage API at all (content-assertion test on comment-stripped code) |
| storage.persist + quota | Requested once automatically in local mode; Settings shows usage/quota (verified live: 1.7 MB of 10 GB) with persist button and backup reminders |
| Local reminders | Once-per-Cairo-day bar: due cards, exams (today/1/≤3 days), overdue tasks, sprint-behind-target; computed from the store contract (works in both modes); server-push section hidden in local mode |
| Arabic/English, RTL/LTR | Switched language while offline: English UI rendered LTR with Arabic data intact |
| Regression gates | `tsc --noEmit` clean · `eslint` clean · **119/119 vitest tests pass** · `next build` succeeds |

## 2. Test inventory (executed, not claimed)

- `tests/backup.test.ts` — 21 tests (export, round-trip, merge rules per entity,
  replace + safety backup, validation rejection, legacy v2, settings handling).
- `tests/reminders.test.ts` — 7 tests (each reminder type, sprint day math,
  priority ordering, daily gate).
- `tests/sw-policy.test.ts` — 15 tests: behavioral driving of the real
  `public/sw.js` fetch router against stubs (Quran bypass, /api bypass,
  sounds/static/navigate caching) + content assertions (versioned caches, no
  IndexedDB usage, consent updates, no Quran in precache) + quran-player
  persistence audit.
- Live offline browser session on the production standalone build (Chromium
  via automation): the checks in the table above.

## 3. Findings

No functional defects were found in Stage 1 scope. Two design notes carried
into Stage 2:

1. **REST mode still shows the legacy v2 export/import** — correct per the
   authorization (REST remains the default until Stage 3), and the UI labels
   it clearly; complete backup is presented as a local-mode capability.
2. **Review logs that reference cards missing from both file and device are
   imported as history** (never deleted — history is sacred). Counts surface
   as warnings in the import preview. Intentional; matches "review history"
   being a first-class backup citizen.

## 4. Residual risks (honest list)

- **Browser HTTP media cache**: streams buffer through the browser's internal
  HTTP cache at the OS level; this is outside application control. The
  application itself never persists Quran audio in Cache Storage, IndexedDB,
  localStorage, PWA assets, or backups (verified).
- **Service-worker lifecycle on exotic browsers**: on very old Safari the
  update banner may not appear; the app still updates on next cold load.
- **Merge is last-import-wins for text fields on entities without a
  modification timestamp** (decks, exams) — conflicts are reported so users
  see what happened.
- **Quota eviction under extreme storage pressure**: mitigated by
  `storage.persist()` + quota warnings + backup reminders; nothing can fully
  prevent OS-level eviction of origin data.

## 5. Data safety confirmation

- The production database, Prisma infrastructure, and all API routes are
  untouched (no deletions, no schema changes).
- No merge to `main`, no push, no deploy. Work continues on
  `local-first/offline-pwa`.
- The service worker never opens or deletes IndexedDB — verified by an
  executable content assertion on the shipped `sw.js`.
- No user data ever enters public caches: `/api/**` is never intercepted by
  the SW, and backups never leave the device except as a user-initiated file
  download.

**Stage 1 verdict: PASS.** Proceeding to Stage 2 (product design audit and
UX/UI redesign) as authorized.

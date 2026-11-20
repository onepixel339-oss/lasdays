# Last Days — Local-First Migration: Execution Plan (v1)

**Date:** 2026-11-20 · **FINAL STATUS: COMPLETE (Stage 1–3).**
Branch `local-first/offline-pwa`, ending at the Stage 3 commits. See
`docs/STAGE3-REPORT.md` for the final audit and delivery report.

- Phase 0+1 (DataStore abstraction, RestStore, Dexie LocalStore behind the flag) — commits `a6e64e7`, `cd241b4`.
- Stage 1 (Phase 2+3: backup v3, offline PWA, Quran online-only, local reminders) — commit `4ff6c4d`.
- Stage 2 (Quiet Study redesign) — commit `e082a65`.
- Stage 3 (Phase 4: backend removal + static conversion) — commits `551bae0`, `8fff3e2`, `4254174` + the final Stage 3 commits. The REST flag and RestStore are deleted; LocalStore is the only production data store; `output: "export"` produces the static site in `out/`. The server-backed state is preserved at tag `server-final`.

The original plan text follows unchanged for the record.

**Date:** 2026-11-20 · **Original plan status:** plan only at writing time; no destructive change made since. Phase 0+1 now implemented (see status above).

---

## 0. Scope and ground rules

Target (per your approved decisions): a genuinely local-first personal study PWA on **Next.js 16 + React + TypeScript static export**, data in **IndexedDB via Dexie**, **no server database, no server accounts, no automatic sync**, **manual export/import** for backup and device transfer, **static hosting only**, reminders **in-app only**, offline as a first-class requirement.

Hard rules honored throughout:

- Keep Next.js 16 (no Vite migration — no technical blocker exists; verified below).
- Keep every educational feature; improve, don't replace.
- Keep the existing REST implementation running until each feature's local replacement is verified; delete server code only in the final phase, after the production-data migration is verified.
- Nothing is pushed, merged to main, or deployed without your approval.
- Before deleting any server infrastructure: tag `v4-server-final`, production DB backed up outside the repo, and a verified migration runbook in place.

---

## 1. Current-state dependency map (verified against the code)

### 1.1 What talks to the server today

| Touchpoint | Files | Used by | Local replacement |
|---|---|---|---|
| Auth: register/login/logout/me/guest (cookie session) | `src/app/api/auth/*`, `src/lib/auth.ts`, `src/app/page.tsx`, `src/components/providers.tsx`, `src/components/app-shell.tsx` | App gating (`ready && !me → /`) | Local profile row in Dexie; onboarding screen replaces login; gating reads local profile |
| Tasks CRUD | `src/app/api/tasks/*` | `tasks/page.tsx`, `home/page.tsx` | Dexie `tasks` |
| Notes CRUD | `src/app/api/notes/*` | `notes/page.tsx` | Dexie `notes` |
| Sprints CRUD | `src/app/api/sprints/*` | `sprints/page.tsx`, `home/page.tsx` | Dexie `sprints` |
| Exams CRUD | `src/app/api/exams/*` | `home/page.tsx` | Dexie `exams` |
| Study sessions (append) | `src/app/api/sessions` | `focus/page.tsx` | Dexie `sessions` |
| Stats aggregation | `src/app/api/stats` | `stats/page.tsx` | Client-side aggregation over Dexie using existing pure `day.ts` |
| SRS decks/cards/review/import | `src/app/api/srs/*` | `srs/page.tsx`, `components/srs/*` | Dexie `decks`/`cards`/`reviewLogs`; SM-2 already pure (`src/lib/srs.ts`) |
| Settings PATCH | `src/app/api/settings` | `providers.tsx` | localStorage (already mirrored) + profile row |
| Radio resolve + proxy | `src/app/api/radio/*`, `src/lib/radio-stations.ts` | `quran/page.tsx` | Client-side mirror fallback over `RADIO_STATIONS` (already client-safe); graceful offline state |
| Push + VAPID + cron | `src/lib/push.ts`, `src/lib/scheduler.ts`, `src/app/api/push`, `src/app/api/cron/tick`, `vercel.json`, `public/sw.js` push handlers | reminders | In-app reminders on open; delete push/cron/VAPID |
| DB client | `src/lib/db.ts` (Prisma + libsql), `prisma/schema.prisma` | all API routes | Dexie; Prisma deleted in final phase |
| Export/import (settings page) | `src/app/(app)/settings/page.tsx` | backup | **Upgraded** to complete versioned backup v3 (see §3.3) |

### 1.2 Already client-safe (carries over unchanged)

`src/lib/srs.ts` (SM-2), `src/lib/day.ts` (Cairo calendar, exact), `src/lib/timer-core.ts` (wall-clock timer), `src/lib/radio-stations.ts` (mirror list), `src/lib/quran-data.ts` (recitation URLs), i18n (`ar.ts`/`en.ts`), theming (pre-paint script + `ld2_prefs`), focus-timer persistence (`ld2_timer`, `ld2_durations`, `ld2_scratch`, `ld2_ambvol`), ambience (6 static mp3s in `public/sounds`, 5.6 MB).

### 1.3 Known gap in the current backup (must be fixed)

The v4 settings export (schema 2) contains `tasks, notes, sprints, decks(+cards), exams` only — **no StudySession history, no ReviewLog, no profile/settings**. Backup v3 (§3.3) makes backups complete by construction, and its importer still accepts v2 files so users can migrate today.

### 1.4 Static-export blockers audit (verified: none)

All 9 pages are client components; no `next/image`; no server actions; no `getServerSideProps`; `cookies()` only inside `src/lib/auth.ts` (deleted); dynamic exports only in API routes (deleted). `src/app/manifest.ts` is a static metadata route (works with `output: "export"`; fallback: static `public/manifest.webmanifest`). `next/font/google` self-hosts at build (build-time network only). `next.config.ts headers()` is ignored by static export → host-specific headers documented in DEPLOY.md. **Conclusion: Next.js retained; Vite migration unnecessary.**

---

## 2. Target design decisions (concrete)

### 2.1 DataStore abstraction

`src/lib/datastore/` — one typed interface, two implementations:

- `types.ts` — `DataStore` interface: CRUD for tasks, notes, sprints, exams, sessions, decks, cards, reviewLogs; `getStats()` aggregation; `getProfile()/saveProfile()`; `exportBackup()/importBackup()`.
- `rest.ts` — wraps today's `fetch("/api/...")` calls (mechanical extraction; behavior identical).
- `local.ts` — Dexie implementation (target).
- `index.ts` — single `store` singleton; runtime switch via `localStorage.ld2_store = "rest" | "local"` (default `rest` until Phase 4 flips the default; `?store=local` URL override for testing).

Pages/components change **only** their data-access calls; UI logic, i18n, theming, layout carry over unchanged.

### 2.2 Dexie schema v1 (IDs preserved — legacy IDs keep ReviewLog↔Card integrity)

```ts
profile:    "++id"                                  // single row: name, avatar, createdAt
tasks:      "id, done, dueDate, createdAt, [done+dueDate]"
notes:      "id, pinned, updatedAt"
sprints:    "id, active, startDate, endDate"
sessions:   "id, startedAt, kind, [kind+startedAt]"  // kind: focus|break, completed kept as field
exams:      "id, date"
decks:      "id, createdAt"
cards:      "id, deckId, dueAt, [deckId+dueAt]"      // image stored as Blob (not data URL)
reviewLogs: "id, cardId, reviewedAt, [reviewedAt]"
kv:         "key"                                    // schema version, lastBackupAt, misc flags
```

- Primary keys are the existing cuid strings from the server (Dexie accepts explicit string keys); new records get `crypto.randomUUID()`.
- `userId` columns disappear (single local user by definition).
- Images: stored as **Blobs** in Dexie (~33% smaller than data URLs, no base64 tax); converted to/from data URLs only inside backup export/import.
- Dexie is browser-only: the store module lazy-initializes and every page is already `"use client"`; a `typeof indexedDB` guard prevents any SSR/prerender access during `next build`.

### 2.3 Profile & settings

- **Profile** (name + avatar + createdAt) = one row in Dexie, included in backups. First run shows an onboarding screen (name + avatar + honest local-profile note) replacing the server login.
- **Device settings** (locale, theme, accent, timer prefs) stay in `localStorage` (`ld2_prefs` etc.) — the pre-paint script keeps working with zero flash. Also included in backups.
- The name-only security notice is replaced by an honest **local-storage notice**: data lives in this browser; clearing site data deletes it; export regularly; use Install (home-screen) on iOS for durable storage.

### 2.4 Backup format v3 (versioned, complete)

```json
{
  "app": "lastdays",
  "format": 3,
  "exportedAt": "2026-11-20T…",
  "profile": { "name": "Ahmed", "avatar": "🌙" },
  "settings": { "locale": "ar", "themeMode": "dark", "themeAccent": "nebula", "timer": {}, … },
  "data": { "tasks": [], "notes": [], "sprints": [], "sessions": [], "exams": [],
            "decks": [], "cards": [], "reviewLogs": [] },
  "counts": { "tasks": 12, "cards": 340, … }
}
```

- `cards[].image` as data URL (JSON-portable); converted to Blob on import.
- **Import modes:** *Merge* (default; union by ID; same-ID conflicts resolved newer-wins using `updatedAt`/`createdAt`; per-type conflict report) and *Replace* (full wipe-restore, gated behind a confirm dialog).
- **Safety:** import runs full validation (format/version/counts/per-record checks: required strings, enum priorities/ratings, date shapes, image data-URL size cap) and **automatically downloads a pre-restore safety backup** before any write.
- **Accepts v2 legacy files** (maps missing sections to empty; reports what was not in the old format).
- Roundtrip integrity: export → import → export produces identical counts and record sets (tested).

### 2.5 Reminders (in-app only)

- Delete: `web-push`, VAPID generation script, `/api/push`, `/api/cron/tick`, `scheduler.ts`, `push.ts`, `PushSubscription`/`PushLog` models, SW push handlers, vercel.json.
- Add: on app open (home page + app shell badge), compute **due cards today**, **exams within 7 days**, **overdue tasks**, **active sprint pace warnings** → a "Today" digest card + count badges on nav. Optional `Notification` API while a tab is open, permission-gated, off by default. No background/server dependency.

### 2.6 Quran radio (client-only)

- `quran/page.tsx` tries `stationMirrors(station)` in order (already 3–4 HTTPS mirrors per station), first playable wins; visible offline/unavailable state with retry; explanation that live radio needs internet. Recitations (quranicaudio.com direct HTTPS mp3s) stream as today; optionally cached on first play for offline replay (best-effort, CORS-dependent — see Risks R6).

### 2.7 Service Worker v2 (offline core)

- Versioned caches (`ld-static-v1`, `ld-audio-v1`); **precache** the static shell: all 9 route HTMLs, icons, manifest, fonts. **Never** touches IndexedDB — cache cleanup only deletes its own versioned cache names, so SW updates cannot lose user data.
- Strategy: static assets cache-first; navigations network-first with cache fallback (+ offline fallback page); `/sounds/*` cache-on-first-play; cross-origin audio cached on play (best-effort); `/api/*` handlers removed once REST is gone.
- Update flow: new SW activates → old-version caches purged → in-app "update available, tap to reload" toast. `storage.persist()` requested on first data write; storage usage shown in Settings.

---

## 3. File-level change inventory

**New:** `src/lib/datastore/{types,rest,local,index}.ts`, `src/lib/datastore/{schema,ids}.ts`, `src/lib/backup/{format,validate,merge}.ts`, `src/components/onboarding.tsx`, `src/lib/reminders.ts`, `src/lib/storage-info.ts`, `scripts/export-prod-users.mjs`, `tests/{backup,localstore,merge}.test.ts`, `tests/e2e-offline.spec.ts` (Playwright).

**Modified:** `src/components/providers.tsx` (profile from store; drop `/api/auth/me`, `/api/settings`), `src/components/app-shell.tsx` (reminder badges), `src/app/page.tsx` (login → onboarding), all 9 feature pages + 3 SRS components (fetch → store), `src/app/(app)/settings/page.tsx` (backup v3 UI, storage info), `src/app/layout.tsx` (metadata unchanged; onboarding route), `public/sw.js` (v2), `next.config.ts` (`output: "export"`, `trailingSlash: true`, drop `headers()`/`serverExternalPackages`), `package.json` (scripts/deps), `DEPLOY.md` (static-host guide), `.gitignore` (`backups/`).

**Deleted (final phase only, after migration verified + tag `v4-server-final`):** `src/app/api/**` (27 files), `src/lib/{db,auth,push,scheduler}.ts`, `prisma/`, `vercel.json`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `scripts/{backup-db,turso-sql,gen-vapid}.mjs`, `src/components/SWRegister.tsx` (replaced), deps `@prisma/client @prisma/adapter-libsql @libsql/client prisma web-push @types/web-push`.

**Kept as-is:** all pure libs (§1.2), i18n, UI components, globals.css, icons, sounds.

**Dependency changes:** add `dexie`, `dexie-react-hooks`; dev: `fake-indexeddb`, `playwright` (offline E2E). Remove the six server deps above. No paid services, no new server infrastructure.

---

## 4. Phase-by-phase plan (each phase ends with a green gate; nothing destructive before Phase 4)

### Phase 0 — Safety net & abstraction (non-destructive, no behavior change)
1. Create branch `local-first/offline-pwa`; tag current commit `v4-server-baseline`. Commit this plan doc.
2. Add Dexie deps + `fake-indexeddb`; extend vitest config.
3. Build `DataStore` types + `RestStore` by mechanically extracting every `fetch("/api/…")` (13 files, §1.1). Pages call `store.*` — zero behavior change, REST still default.
4. **Gate:** `typecheck` + `lint` + `vitest` green; manual smoke of every feature on REST mode; no visual changes.

### Phase 1 — Local core (REST still available as fallback)
1. Dexie schema v1 + `LocalStore`; ID generation; SSR-safe lazy init.
2. Onboarding screen replaces login when local mode is default-off? (No — behind flag in this phase: profile bootstrap on first `?store=local` use.)
3. Migrate resources in this order, each with unit + integration tests before moving on: tasks → notes → sprints → exams → sessions → SRS (decks/cards/review/CSV import) → stats (client aggregation with `day.ts`) → settings/profile.
4. `storage.persist()` + storage-usage UI in Settings.
5. **Gate:** full typecheck/lint/vitest; per-resource integration tests (fake-indexeddb); offline spot-checks (`?store=local` with dev server network-throttled); AR/EN + RTL pass; focus timer survives navigation and reload in local mode.

### Phase 2 — Backup, restore & production-data migration (the critical requirement)
1. Backup v3 module (serialize/validate/merge/replace + pre-restore safety backup) + Settings UI (export everything incl. images/history/settings; import v2+<v3; conflict report; lastBackupAt nudge).
2. `scripts/export-prod-users.mjs` — **runs offline on your machine against a COPY of the production DB** (never deployed, never in public assets): emits one v3 file per user (`backups/<usernameKey>.json`, gitignored), prints per-user record counts, and a verification checklist (DB counts == file counts).
3. You review and distribute each user's file privately (the app's Import restores it to their device's local DB). Old server stays untouched and running.
4. **Gate:** unit tests (validation rejects malformed/mutated files; merge/conflict matrix; v2 compatibility); roundtrip integrity test; a scripted end-to-end: seed legacy DB → export tool → import into a fresh browser profile → counts match.

### Phase 3 — Server-dependency removal (feature-level, REST still in tree)
1. Radio client-only mirror fallback + graceful offline state (delete usage of `/api/radio`).
2. In-app reminders (§2.5) replacing push; remove push subscription UI/calls.
3. SW v2 (§2.7) with offline shell, audio caching, safe update flow.
4. **Gate:** all tests green; offline navigation + data entry verified with network disabled (Playwright offline context + manual protocol); AR/EN pass.

### Phase 4 — Static export & server-code deletion (first destructive step — requires your explicit approval + confirmed backup)
Preconditions: Phase 2 migration runbook executed/verifiable; `v4-server-final` tag; production DB backup file stored outside the repo.
1. `next.config.ts` → `output: "export"`, `trailingSlash: true`; manifest fallback if needed; host headers documented.
2. Flip default store to `local`; remove `rest.ts` + store switch; delete the full server inventory (§3); prune deps.
3. Real static build (`out/`); serve it locally; verify: open without backend, navigate all routes offline, read/write offline, close/reopen persistence, backup restore, SW update without data loss.
4. Rewrite `DEPLOY.md` (GitHub Pages / Netlify / Cloudflare Pages / Vercel-static; header recommendations; SPA routing notes).
5. **Gate:** production build + typecheck + lint + vitest + Playwright offline suite all green; zero `/api/` references remain (`grep -r "api/" src/`); zero gamification/prisma/web-push references.

### Phase 5 — Final independent verification & handoff
1. Full matrix: mobile + desktop viewports, offline/online, AR/EN, RTL/LTR, install flow, iOS Safari + Android Chrome notes, all 9 features, backup/restore on a second device profile.
2. Second independent review against: original audit findings, v4 product requirements, and this architecture's decisions — with an honest remaining-issues list.
3. Deliver: final report + migration runbook results + static deploy bundle instructions. **No push, no merge, no deploy without your approval.**

---

## 5. Production-data migration runbook (requirement §5 — summary)

1. **Backup first:** stop writes; snapshot the Turso/SQLite production DB to a file kept outside the repo (`scripts/db:backup` path retained in the migration tool). Verify snapshot counts before anything else.
2. **Per-user export:** `node scripts/export-prod-users.mjs --db <snapshot-file> --out backups/` → one complete v3 backup per user; tool prints per-user counts and cross-checks them against the snapshot; never deletes or mutates the snapshot or the live DB.
3. **Private distribution only:** files leave your machine only via a channel you choose per user. No public URLs, no static-host inclusion (enforced: `backups/` gitignored + tool writes outside `public/`).
4. **User-side import:** Settings → Import (accepts v3 and old v2). Auto pre-restore backup, validation, conflict report; counts shown after import.
5. **Verification before decommission:** a user counts as migrated when their device shows matching record counts (the import report). Only after you confirm migration is complete and verified do we tag/keep the old DB (it is never deleted by us — decommissioning it is your call), and only then does Phase 4's deletion of auth/DB code proceed.

---

## 6. Risks & honest mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Browser data loss** (clear site data / uninstall) — replaces the old "forgot my name" failure mode | High | `storage.persist()`; "last backup N days ago" nudge in Settings + home digest; one-tap complete export; install-to-homescreen guidance (installed iOS PWAs are exempt from Safari's 7-day eviction; regular Safari tabs are not) |
| R2 | **No cross-device sync** — name on a second device shows empty data | High (product expectation) | Onboarding + settings copy states data is device-local; backup import is the transfer path; export-prod tool migrates existing users explicitly |
| R3 | **Migration gap** — a user who never imports loses server data when the server is eventually retired | High | Server stays up during the whole transition; per-user export files; v2 import works today; decommission only after your verified checklist |
| R4 | **SSR/prerender vs IndexedDB** — build-time prerender touching browser APIs | Medium | Lazy store init + `typeof indexedDB` guards; caught by `next build` (typecheck/build gate per phase) |
| R5 | **SW caching bugs** breaking navigation or shipping stale assets | Medium | Versioned caches; precache manifest generated from the build output; network-first navigations; update toast; SW never touches IndexedDB; offline E2E suite in Phase 5 |
| R6 | **Cross-origin recitation caching** may fail (CORS/opaque responses) | Low-Medium | Best-effort cache-on-play with explicit "available offline" indicator; graceful streaming-only fallback; live radio documented as online-only |
| R7 | **Static export host quirks** (trailingSlash, headers, SW scope) | Low | `trailingSlash: true`; DEPLOY.md per-host recipes; SW served from root scope |
| R8 | **Large images exceed quota** | Low | Images already downscaled client-side (≤ ~600 KB) in v4; Blob storage trims ~33%; storage-usage UI; export size warning |
| R9 | **Conflicting duplicates on import** (restore onto existing data) | Medium | Two explicit modes (merge with newer-wins + report / replace with confirmation); auto pre-restore backup; roundtrip + conflict-matrix tests |
| R10 | **Playwright offline emulation flakiness** undermining "tested offline" claims | Medium | Automated suite where reliable + a documented manual offline protocol (DevTools offline + cold restart) with recorded evidence; claims limited to what was actually executed |

---

## 7. Testing & verification matrix (only executed tests will be reported as passing)

| Layer | Tool | Scope |
|---|---|---|
| Unit | vitest (+ `fake-indexeddb`) | backup validate/merge, Dexie store CRUD, stats aggregation vs fixtures, SM-2 (existing), day.ts (existing) |
| Integration | vitest + scripts | v2→v3 import, roundtrip integrity, prod-export tool counts, per-resource store flows |
| E2E online/offline | Playwright (offline context) + manual protocol | install shell, all routes, CRUD per feature, reload/navigation persistence, backup restore, SW update, AR/EN, RTL |
| Build | `next build` (static), `tsc --noEmit`, `eslint .` | every phase gate |
| Manual | documented protocol | mobile viewports, iOS/Android real devices if available, PWA install, radio graceful-failure |

---

## 8. Explicitly not done until you approve

- Any destructive deletion (Phase 4), any commit/push/merge beyond the Phase 0 branch + plan-doc commit, any change to the production database, any deployment.
- No automatic sync, no new server database, no paid services — now or later phases.
- Vite migration: not needed (§1.4); Next.js retained.

**Approval requested for:** Phase 0 + Phase 1 start (non-destructive). Phases 2–3 proceed under the same approval unless you pause; Phase 4 requires a separate explicit go-ahead after migration verification.

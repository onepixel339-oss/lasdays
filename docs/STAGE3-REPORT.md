# Last Days — Stage 3 Final Report
## Complete Backend Removal & Static PWA Conversion

**Date:** 2026-11-20 · **Branch:** `local-first/offline-pwa` · **Baseline preserved:** tag `server-final` (last server-backed state)
**Authorization:** user's Stage 3 final authorization (data reset authorized; no legacy user migration; no push/merge/deploy).

---

## 1. Final architecture

```
┌──────────────────────────── STATIC HOST (out/, ~8 MB) ────────────────────────────┐
│  Next.js 16 output:"export" — pre-rendered HTML for all 10 routes + manifest    │
│  + sw.js (Service Worker v3) + icons + 6 ambient mp3s (5.6 MB)                   │
│  + self-hosted fonts (next/font, no Google runtime dependency)                    │
│                                                                                   │
│  NO Node.js server · NO API routes · NO database · NO env vars · NO secrets       │
└───────────────────────────────────────────────────────────────────────────────────┘
        │ served over HTTPS                     │
        ▼                                        ▼
┌─ Browser (this device) ─────────────────────────────────────────────────────────┐
│  React app (client components) → DataStore (LocalStore ONLY)                    │
│  ├─ Dexie 4 → IndexedDB "lastdays" (10 tables: profile, tasks, notes,            │
│  │   sprints, sessions, exams, decks, cards, reviewLogs, kv)                     │
│  ├─ localStorage: prefs (lang/theme/accent), timer, scratch, volumes             │
│  ├─ Service Worker v3: Cache Storage only (ld-static-v3/ld-pages-v3)            │
│  │   app shell + visited routes + ambient sounds; consent-based updates          │
│  └─ Backup engine v3: complete export/import (merge/replace)                    │
│                                                                                   │
│  Quran audio: ONLINE ONLY — radio mirrors (radiojar) + recitations               │
│  (quranicaudio, direct https mp3) streamed live; never cached, never stored,      │
│  never in backups; graceful offline refusal                                       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Removed backend components

| Category | Removed |
|---|---|
| API routes (46 files) | `src/app/api/**`: auth (register/login/logout/me/guest), tasks, notes, sprints, exams, sessions, stats, srs (decks/cards/review/import), settings, radio (resolve + self-healing proxy), push, cron/tick |
| Server libs | `src/lib/db.ts` (Prisma dual-mode client), `src/lib/auth.ts` (cookie sessions), `src/lib/api.ts` (route helpers/rate limiter), `src/lib/push.ts` (Web Push/VAPID), `src/lib/scheduler.ts` (60s reminder loop) |
| Database | `prisma/` (schema, v3/v4 manual SQL migrations, turso-init.sql), local `db/` (SQLite) |
| Infra | `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `.dockerignore`, `.env`, `.env.example` |
| Deps | `prisma`, `@prisma/client`, `@prisma/adapter-libsql`, `@libsql/client`, `web-push`, `@types/web-push`; `db:*` + `postinstall` scripts |
| Scripts | `backup-db.mjs`, `gen-vapid.mjs`, `turso-sql.mjs`, `integration-api.sh`, `integration-migrate.mjs` |
| Config | `vercel.json` crons (now header-only), `next.config.ts` serverExternalPackages/headers/standalone |
| Client REST layer | `src/lib/datastore/rest.ts` (RestStore), the `?store=` URL flag, the `ld2_store` localStorage flag, store-mode tests |
| SW | push + notificationclick handlers; cache names bumped v2→v3 (old caches auto-evicted; IndexedDB untouched) |

Server auth removed; the existing local profile system (name-only onboarding, guest mode, rename/claim) is the only identity. No centralized accounts, no sync.

## 3. Final technology stack

- **Next.js 16.1** (Turbopack) with `output: "export"` — React 19, TypeScript strict
- **Tailwind CSS 4** + Radix UI primitives + lucide-react + shadcn-style components ("Quiet Study" design system preserved)
- **Dexie 4.4** on IndexedDB — the only data store
- **Service Worker v3** (hand-written, no dependency) — offline shell + audio policy
- **Vitest 3** (+ fake-indexeddb) — 115 unit tests
- Dev deps only beyond that; zero server runtime dependencies

## 4. Files changed / deleted (Stage 3 commits)

- `551bae0` — LocalStore permanently activated (flag + RestStore deleted; settings/onboarding/SWRegister simplified; i18n cleaned)
- `8fff3e2` — client-side Quran radio mirror ladder (no server resolver/proxy; online-only rule intact)
- `4254174` — entire backend removed (46 API routes, 5 server libs, prisma, Docker, env, push/cron, backend deps; SW v3; vercel.json headers; package.json 5.0.0)
- final commits — manifest force-static, DEPLOY.md static guide, plan/report docs, visual-test script for the static export

## 5. Final Dexie schema (unchanged from Stage 1, verbatim)

```ts
this.version(1).stores({
  profile: "++id",                       // single row id===1 (username, avatar, locale, themeMode, themeAccent, isGuest, createdAt)
  tasks: "id, dueDate, createdAt",
  notes: "id, updatedAt",
  sprints: "id, createdAt, startDate, endDate",
  sessions: "id, startedAt, kind",
  exams: "id, date",
  decks: "id, createdAt",
  cards: "id, deckId, dueAt",
  reviewLogs: "id, cardId, reviewedAt",
  kv: "key",
});
```
Dates are ISO-8601 UTC strings (lexicographic == chronological). IDs are UUID strings.

## 6. Static build results

- `next build` → **13/13 static pages** (/, 10 routes, manifest, robots; +404)
- `out/` total **~8.1 MB** (incl. 5.6 MB ambient sounds; `_next/static` 1.7 MB)
- All routes pre-rendered; fonts self-hosted at build (no runtime Google Fonts)
- Zero runtime environment variables; repo contains no secrets

## 7. Actual test results (all executed)

**Unit (vitest): 115 passed / 9 files** — backup (21: validate/merge/replace/roundtrip), localstore (23: CRUD + validation + profile rules), sw-policy (15: Quran never cached, /api never cached, ambience+shell cached, versioned caches, activate deletes only foreign caches), stats-core, timer-core, reminders, csv-auth (via lib/name), day, srs.

**TypeScript:** `tsc --noEmit` — 0 errors. **ESLint:** 0 errors.

**Static hosting preview (scripts/static-preview.mjs — clean URLs, MIME, immutable statics, no-cache sw.js):**
- Direct route access: all 10 routes + `/` return 200 (`/home` … `/quran`)
- Nested route reload works; deep-link `/srs` cold load works; client-side navigation works (Link prefetch + RSC payloads are static files served verbatim)
- Zero `/api` requests across whole sessions (network log verified)
- No Node.js server: the entire app is files under `out/`

**Offline browser tests (agent-browser / headless Chromium; verified twice as flag-offline AND with the static server process killed — true network absence):**
- Reload of `/tasks` with server dead → page + data render (SW cache + IndexedDB)
- Client-side navigation offline across routes
- Task created offline; note created offline; flashcard deck + 2 cards created; both cards reviewed offline (SM-2 reschedule + 2 review logs written offline)
- Focus timer started offline, runs wall-clock-accurate, survives navigate-away-and-back
- Stats page renders offline (computed from IndexedDB)
- IndexedDB persistence across page reloads and across a full Service Worker update cycle (2 tasks + 1 note + profile preserved through update + reload)
- SW update: byte-changed sw.js → install → wait → consent banner → reload → data intact; SW never touches IndexedDB

**Backup/restore (E2E through the real UI):** export produced a complete v3 file (profile, 2 tasks, 1 note, 1 deck, 2 cards, 2 reviewLogs — counts match DB); replace-restore wiped post-export additions and restored exact records with original IDs; automatic safety backup downloaded before the wipe. No Quran audio bytes in the backup file (verified by content scan).

**Quran network-only tests:**
- Radio while offline → immediate explicit refusal ("صوت القرآن محتاج إنترنت" + retry button); zero playback attempts
- Radio online → streams live from radiojar CDN via the client mirror ladder ("يبثّ الآن" state)
- Cache scans after radio playback + recitation navigation: **zero** radiojar/quranicaudio/mp3 entries in `ld-static-v3` (80 entries), `ld-pages-v3` (15 entries) and localStorage
- Quran player engine still has `preload="none"` + offline gate; SW policy tests (15) enforce the denylist behaviorally

**Ambient audio offline tests (independent of the Quran policy):**
- `/sounds/rain.mp3` + `/sounds/white.mp3` cached in `ld-static-v3` after first play; offline (server dead) → white noise plays from cache (WebAudio engine `current:"white"`, ctx running)
- A never-played sound (cold cache) offline → graceful silence, no error surfaced
- The blanket restriction does NOT disable ambient sounds — the two behaviors verified independently

**Visual regression (VLM-assisted on real screenshots + DOM checks):** mobile AR dark RTL (Arabic shaping correct, RTL layout correct), EN dark LTR, EN light, desktop 1440 rail — Quiet Study design system intact; sticky header + bottom-nav padding verified via viewport screenshots (full-page capture artifacts ruled out); no gamification strings on home/stats; settings shows Backup & Restore + local-data notice, no server-push UI.

## 8. Hosting instructions

Full guide in **DEPLOY.md**: Vercel (auto-detected static export, header rules in vercel.json), Netlify (`out/` publish dir + `public/_headers`), Cloudflare Pages (`out/` + `_headers`), plus generic Nginx recipe. HTTPS is required (SW + IndexedDB); all three hosts provide it by default. No paid service needed anywhere.

## 9. Remaining issues and limitations

1. **Radio on HTTPS pages depends on the browser's mixed-content auto-upgrade** (radiojar 302s to `http://` nodes; modern Chrome/Edge/Firefox/Safari auto-upgrade audio to https). On a browser without auto-upgrade, live radio fails with the clear retry error (recitations are direct https and unaffected). Documented in code comments.
2. **One profile per device, no sync** — by design. Transfer = backup file.
3. **Data is device-local** — clearing site data / uninstall deletes it; the app requests persistent storage and nudges backups (the offline-first trade-off the product chose).
4. Ambient sounds must be played once online to be available offline (first play caches them) — by design, conserves quota.
5. Local dev (`next dev`) still works but there is no `next start`; use `npm run preview` for the production shape.
6. `agent-browser`'s `set offline` flag can be bypassed by SW-mediated fetches in some builds — the authoritative offline evidence in this report was therefore taken with the server process killed.

## 10. Confirmation of restrictions

- Worked only on `local-first/offline-pwa` (verified at start; single tag `server-final` added at the server-backed boundary).
- Nothing pushed; nothing merged into `main`; no production deployment; no secrets exposed (none exist — env files deleted).
- Git history preserved (all prior commits intact; deletions are tracked as deletions).
- Working tree clean at delivery.

## 11. Independent final audit

- **No production backend required** — verified: zero API routes in the tree, zero `fetch("/api")` in client code, zero API calls observed in live network logs, no server process needed to serve or use the app.
- **No centralized database required** — Prisma/SQLite/Turso fully deleted; no `DATABASE_URL` anywhere.
- **LocalStore is the only production data store** — `getStore()` constructs only `LocalStore`; RestStore deleted; DataStore.mode: "local".
- **The application is genuinely static** — `output: "export"`, `out/` served by a plain static file server; no Node runtime.
- **All essential features work offline** — verified feature-by-feature with the server dead (§7).
- **Quran audio remains online-only** — verified behaviorally + cache scans + file scans (§7).
- **Ambient audio works offline** — verified independently of the Quran policy (§7).
- **Backup and restoration remain functional** — verified E2E through the UI (§7).
- **The Stage 2 redesign is preserved** — no redesign introduced; visual regression confirms the Quiet Study system across themes, directions, and viewports.

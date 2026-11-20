# Second Independent Audit — v4 Implementation Review

**Date:** 2026-11-20 · **Branch:** `improvements/name-auth-no-games` · **Reviewer:** independent re-audit of the completed work (not the original audit)

This document re-audits the codebase AFTER implementation, against three references:
1. The original audit findings (P0 → P3).
2. The product requirements issued with the implementation order (name-only auth, gamification removal, preservation of core features, data safety).
3. The existing application's behavior and regressions.

Everything below was **actually executed or inspected** in this working tree — nothing is marked passed based on build success alone.

---

## 1. Verification evidence (executed)

| Gate | Command | Result |
|---|---|---|
| TypeScript (strict + `noUncheckedIndexedAccess` + `noImplicitAny`) | `npx tsc --noEmit` | ✅ 0 errors |
| ESLint (flat config, `next/core-web-vitals` + TS rules) | `npm run lint` | ✅ 0 errors, 0 warnings |
| Unit tests (Vitest) | `npm test` | ✅ 43/43 passed |
| Production build (Turbopack, standalone) | `npm run build` | ✅ compiled clean, 0 warnings |
| DB migration invariants (legacy v3 → v4) | `node scripts/integration-migrate.mjs` | ✅ 23/23 checks |
| Live API flows (production server + curl) | `bash scripts/integration-api.sh` | ✅ 37/37 checks |
| UI visual + flows (headless browser) | `bash scripts/ui-visual-test.sh` + screenshots | ✅ AR/EN × mobile/desktop verified |
| Gamification sweep | `rg` over `src/` | ✅ zero references to xp/streak/badges/quests/freezes/levels/celebrate |
| Password sweep | `rg` over `src/` | ✅ zero password UI/API/storage; only the "no passwords by design" notices |
| Dict completeness | scripted audit of every `t("…")` path against `ar.ts` | ✅ 0 missing keys |

Key executed behaviors (from the live integration run):

- Login with `AHMED` opens the legacy account named `Ahmed` — **with all of its pre-migration study data intact** (2 tasks, 1 note, 1 deck + 2 cards, 2 sessions, 1 exam, 1 sprint preserved through the migration).
- `/api/auth/me` returns no `xp`, `streak`, `freezes` fields.
- Session POST accepts 30 s–8 h and rejects anything else; GET aggregates **Cairo-calendar** today.
- Completing a task stamps `doneAt` and returns **no** XP/event payload.
- `/api/quests` → 404 (route removed).
- Exam create **and edit** work; guest → named-account claim works and the claimed name is then login-able (case/whitespace normalized).
- Duplicate names are rejected case-insensitively (`username_taken`); guests cannot be logged into by name (`no_account`); names under 3 chars and `guest_*` prefixes rejected.
- Register rate-limit engages (429 after 10/min per IP).
- Security headers present (`X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`).
- Browser: name-only auth screen with the mandatory security notice; home/focus/srs/stats/settings render in Arabic (RTL) and English (LTR); mobile dock and desktop rail both correct; no gamification UI anywhere.

---

## 2. Original audit findings — final disposition

### P0 (critical)

| Finding | Resolution | Status |
|---|---|---|
| Focus timer logged preset duration regardless of actual elapsed time | Timer core accumulates real running time across pauses; completed phases log the planned duration; skipped phases log real elapsed; sub-30 s phases aren't logged | ✅ Fixed (+9 unit tests) |
| Skip button logged a **full** focus session without studying | Skip now logs only real elapsed time | ✅ Fixed |
| Timer died on navigation/reload; `startedRef` never used; drift from `setInterval` decrement | Wall-clock `endsAt` anchor; state persisted in `localStorage`; restore completes an expired phase and logs it honestly; interval only reads, never accumulates | ✅ Fixed |
| Module-level `PRESETS` mutation (cross-user, cross-tab bleed) | `PRESETS` deleted; durations live in component state + `ld2_focus_settings`, clamped 1–180 min, never mutated module-wide | ✅ Fixed |
| Duplicate `AppProvider` (root + `(app)` layouts) → double `/me` fetch, duplicated state | Single provider in the root layout; `(app)/layout.tsx` renders only the shell | ✅ Fixed |
| Flashcard review queue bug — "again" on the last card ended the session / stale `queue` read | Next queue computed from the current snapshot; "again" re-queues **then** the emptiness is evaluated | ✅ Fixed |
| Theme initialized wrong (hardcoded `dark`, FOUC on switch, duplicated providers fighting) | Pre-paint script applies saved prefs before first paint; provider syncs once; no FOUC | ✅ Fixed |
| Gamification intertwined with every route (XP/badges/quests/streak/freeze) | Removed end-to-end: models, columns, `game.ts`/`game-shared.ts`, `award()` call sites, quests API, scheduler streak logic, push types, all UI surfaces, i18n keys | ✅ Removed (product requirement) |
| UTC vs Cairo day boundaries (tasks/sprints used device/UTC "today") | Single client-safe `src/lib/day.ts` (`todayCairo`, `startOfCairoDay` exact via bisection incl. DST) used by sessions GET, stats, home, tasks, sprints | ✅ Fixed (+16 day tests incl. DST boundary) |

### P1 (high)

| Finding | Resolution | Status |
|---|---|---|
| API validation gaps (session duration uncapped, task/note length uncapped) | Caps everywhere: sessions 30 s–8 h, titles ≤200, subjects ≤60, notes content ≤20 k, card text ≤500, sprint pages ≤50 k, exam title ≤80 | ✅ Fixed |
| No rate limiting on auth endpoints | Best-effort in-memory limiter (register 10/min, login 20/min, guest 10/min per IP); verified 429 in live test | ✅ Fixed (see risk R2) |
| Cookie without `secure` in production | `secure: true` when `NODE_ENV=production` | ✅ Fixed |
| Expired sessions never cleaned | Throttled hourly sweep in `currentUser()`; `expiresAt` index added | ✅ Fixed |
| Username uniqueness was case-sensitive ("Ali" vs "ali") | `usernameKey` (lowercased/trimmed) unique; migration backfills + auto-renames collisions | ✅ Fixed |
| `db.user` query log noise in dev | Removed `log: ['query']` | ✅ Fixed |
| Missing DB indexes on every FK/filter path | 15 indexes added via schema + migration (sessions, cards `dueAt`, review log, tasks done, notes pinned, auth sessions…) | ✅ Fixed |
| Deck list shipped all card image data URLs | List returns counts only (no `image` payloads); new `GET /api/srs/decks/[id]` loads full cards on demand; client downscale tightened to ≤768 px/600 KB with server-side cap at 800 k chars | ✅ Fixed |
| `ignoreBuildErrors: true` + `noImplicitAny: false` + `reactStrictMode: false` | All reversed; strict TS is now enforced by CI gates | ✅ Fixed |
| No ESLint config at all | `eslint.config.mjs` (native flat config) with `no-unused-vars`/`no-explicit-any` errors; repo lints clean | ✅ Fixed |
| Missing deployment files referenced by docs (`Dockerfile`, `docker-compose.yml`, `.env.example`) | All three added + `.dockerignore` + `docker-entrypoint.sh`; DEPLOY.md rewritten to match reality | ✅ Fixed |
| `doneAt` never written | Stamped on the done transition (both directions) | ✅ Fixed |

### P2 (medium)

| Finding | Resolution | Status |
|---|---|---|
| Sessions GET could undercount today (take 30 + server-local midnight) | SQL aggregate over Cairo-day bound; count+sum exact | ✅ Fixed |
| No editing for tasks/decks/exams/sprints | Task inline editor; deck editor (name/subject/color); exam edit dialog + new `PATCH /api/exams/[id]`; sprint rename/total-pages editor + `PATCH` support | ✅ Added |
| Export missed data, no import | Export now JSON with tasks/notes/sprints/exams/decks incl. **card images**; import restores them (bulk fast path when no images, per-card path with images); never deletes existing data | ✅ Added |
| Viewport `maximumScale: 1` blocked pinch-zoom | Removed (zoom enabled) | ✅ Fixed |
| Weak/generic `aria-label`s; more-sheet lacked Escape | Contextual localized labels + `aria-pressed`/`aria-current` + Escape-to-close + `role="status"` timer announcements | ✅ Improved |
| SW cache never versioned | Bumped to `ld-v4`; `/sw.js` served `no-cache` so clients pick up updates | ✅ Fixed |
| Stale/unused deps (next-auth, next-intl, framer-motion, recharts, radix×20, dnd-kit, mdx, sonner, zustand, …) | 24 runtime deps removed; 2 re-added as genuinely used (`@radix-ui/react-slot`, `@radix-ui/react-toast`) | ✅ Cleaned (lockfile regenerated) |
| `tsconfig.tsbuildinfo` committed, `bun-types` cruft | Removed; `.gitignore` already covers | ✅ Cleaned |
| CSV parser rejected Arabic-comma files (separator class contained a fullwidth `，` U+FF0C instead of `،` U+060C) | Character classes now accept ASCII + Arabic + fullwidth commas; covered by tests | ✅ Fixed (bug found **during** re-audit) |

### P3 (low)

| Finding | Resolution | Status |
|---|---|---|
| `previewInterval`/`readiness` untested | Covered by unit tests | ✅ |
| No testing infrastructure at all | Vitest + 43 unit tests + two integration scripts kept in `scripts/` | ✅ |
| Homepage hero "level" line, desktop ProgressCard | Removed with gamification; replaced by an honest "focus minutes today" chip | ✅ |
| `guest_` usernames could be registered as real names | Reserved-prefix rejection | ✅ |

---

## 3. Product requirements — compliance matrix

| Requirement | Implementation | Verified how |
|---|---|---|
| Name-only auth, no passwords | Register/login/claim all name-based; `passwordHash` dropped from schema and migration; UI field removed | Live API tests; browser screenshots |
| Existing users access accounts by name | `usernameKey` migration backfill; case-insensitive login verified against a real migrated v3 DB | Migration + live API tests |
| Unique + validated names | Length 3–24, control-char rejection, case-insensitive uniqueness, whitespace collapse, `guest_` reserved | Live API tests |
| Preserve users + study data | Migration invariant suite (23 checks); legacy account login returns intact data | `scripts/integration-migrate.mjs` |
| Security limitation communicated | Persistent notice on the auth screen **and** in Settings (AR + EN), explicit "not real security" wording | Browser snapshots (both languages) |
| Remove XP/levels/badges/quests/claims/freeze credits + all game APIs/UI/DB fields | Deleted: `game.ts`, `game-shared.ts`, quests route, 3 models, 6 user columns, scheduler streak/freeze logic, streak/freeze push types, all UI (chips, bars, badges grid, quests card, claim buttons), i18n keys | rg sweep + live API (no `xp`/`streak`/`level`/`badges` in any response) + browser checks |
| Keep educational stats/history/progress | Weekly bars, 90-day heatmap, totals (hours/sessions/cards/tasks), per-subject, review logs, due tracking — all intact and index-backed | Browser + API |
| Preserve Pomodoro/flashcards/tasks/sprints/exams/Quran/ambience/PWA/i18n/RTL | All present; Quran page and ambience untouched except i18n key cleanup; PWA manifest/SW kept (cache bumped) | Browser screenshots; build route list |
| Separate branch, no direct push | All work committed on `improvements/name-auth-no-games`; no push performed | git log |
| Review schema/migrations, backups before destructive changes | `prisma/migrations-manual/v4-…sql` + `scripts/backup-db.mjs` + mandatory backup section in DEPLOY.md | Files present; documented flow |
| No paid services / no secret exposure | No new external services; `.env.example` has empty values; `.gitignore` covers `.env*` | Inspection |
| Logical groups, tested per group | See commit plan below; each group passed tsc+lint before the next | Executed |
| Run build/lint/tsc/tests; test auth & features & timer & migration & mobile & AR/EN & no-gamification & regressions | All executed (see evidence table) | Executed |
| Do not claim untested things | Every claim in this doc maps to an executed command above | — |

---

## 4. Remaining risks & honest limitations

- **R1 — Name-only access is not authentication.** Anyone who learns a name owns the account. This is the requested design; the interface discloses it in both languages. Any future hardening (passkeys, PIN, magic link) requires a product decision and would not conflict with the current schema.
- **R2 — Rate limiting is in-memory and per-instance.** On serverless it is best-effort (each lambda instance keeps its own window); on Docker/VPS it is fully effective. A shared store (e.g. Turso-backed counter) would make it strict; deferred as it adds a DB write per request.
- **R3 — Offline session logging.** A focus session completed while offline cannot reach the server; the client drops it silently after the fetch fails (pre-existing behavior; the timer itself keeps working offline through localStorage). A durable outbox queue would be the fix and fits the local-first architecture discussed in the companion analysis.
- **R4 — Away-completion cap.** If the app stays closed through the end of a running focus phase, restore logs the **planned** duration (capped). Actual studying while closed is unknowable — we chose the honest cap over crediting unknown time.
- **R5 — Cron timing on Vercel Hobby is approximate** (platform behavior). `logOnce` dedup keeps reminders exactly-once per day regardless.
- **R6 — External stream dependency.** Quran radio depends on the radiojar CDN; the resolver→proxy fallback ladder is unchanged and still self-healing.
- **R7 — Backup images increase export size.** The JSON backup now includes card images (data URLs). A 200-image deck can produce a ~100 MB file. Deliberate choice: completeness over size; documented in the UI hint.
- **R8 — Guest data reachability.** Guest accounts use generated names and cannot be recovered if the session cookie is lost. Pre-existing; unchanged.

## 5. Things checked and deliberately NOT changed

- Quran radio resolver/proxy ladder, ambience engine, media session integration — already solid; touching them would add regression risk with no audit finding attached.
- `vercel.json` cron schedule (08:00/20:00 UTC) — matches the reminder windows in Cairo time.
- SM-2 scheduling parameters (learning steps, ease bounds) — correct and now test-locked.
- PWA manifest identity, icons, shortcuts — unchanged.

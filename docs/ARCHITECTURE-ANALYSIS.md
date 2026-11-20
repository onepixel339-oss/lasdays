# Last Days — Technology & Deployment Architecture Analysis

**Date:** 2026-11-20 · **Status: recommendation only — no migration has been started, per your instruction.**

This analysis is based on the actual v4 codebase (`src/`, `prisma/schema.prisma`, `public/sw.js`), not on assumptions. Its goal is to answer one question honestly: **should Last Days become a fully client-side, offline-first PWA without a server-side database?**

---

## 0. What the code actually depends on today

| Server-side dependency | Where | What breaks without it |
|---|---|---|
| Prisma + SQLite/Turso | `src/lib/db.ts`, all `src/app/api/**` | All CRUD (tasks, notes, decks/cards, sessions, exams, sprints) |
| Cookie sessions (`AuthSession`) | `src/lib/auth.ts` | "Login" — which after v4 is already only a name |
| Web Push + VAPID + cron | `src/lib/push.ts`, `src/lib/scheduler.ts`, `vercel.json` | Review/exam reminders while the app is closed |
| Radio resolver + proxy | `src/app/api/radio/*` | Quran radio fallback when radiojar redirects to `http:` (mixed content) |
| Static hosting of SW + sounds | `public/` | Nothing — moves trivially |

Three client-side facts matter a lot for this decision:

1. **The SRS scheduler is already a pure client-safe module** (`src/lib/srs.ts` — no db import). SM-2 scheduling, previews and readiness run anywhere.
2. **The focus timer already persists locally** (`localStorage`, wall-clock anchored) and survives reloads — it never needed the server.
3. **All media (card images, sounds) are already data URLs / static files.** There is no file storage dependency.

In other words: the app has already drifted client-ward. The server today is a per-user CRUD bucket plus reminders and a radio proxy.

---

## A. Can the current application work without SQLite, Turso, Prisma and a backend database?

**Yes — completely.** There is no feature that joins data across users, no admin, no sharing, no server-side search. Every query in the API layer is scoped `where userId = <the one logged-in user>`. That is the signature of a local database wearing a server costume. Every model maps 1:1 to an IndexedDB table, and the single-user "bucket" disappears entirely (no userId keys needed).

The three genuinely server-side functions (push scheduling, cron, radio proxy) are *not* database functions — they can remain as thin serverless functions or be redesigned client-side (see C/E).

## B. Can the database layer be replaced by browser storage (IndexedDB)?

**Yes, cleanly.** A concrete mapping:

| Prisma model today | IndexedDB equivalent (Dexie) | Notes |
|---|---|---|
| `User` | `profiles` (usually exactly one row) | Name becomes a *local label*; v4's `usernameKey` becomes irrelevant |
| `Task`, `Note`, `Sprint`, `Exam` | direct mirrors | Same fields; indexes on `done`/`dueDate`/`date` |
| `StudySession` | mirror | Cairo-day aggregations computed client-side (the same `day.ts` logic is already shared) |
| `Deck` / `Card` | `decks` / `cards` (+ `dueAt` index) | Images stored as **Blobs** (better than data URLs: ~33% smaller, no base64 tax) |
| `ReviewLog` | mirror | Powers the stats page |
| `AuthSession`, `PushSubscription`, `PushLog` | **deleted** | No sessions to a server; push redesigned (E) |

The v4 work actively prepared this: `src/lib/srs.ts` (pure), `src/lib/day.ts` (pure, client-safe Cairo calendar), `src/lib/timer-core.ts` (pure), and the settings/provider layer already reads/writes localStorage. The API surface is small (~14 endpoints) and uniformly shaped (`GET/POST/PATCH/DELETE` per resource), so a `DataStore` interface with two implementations (`RestStore` today, `LocalStore` later) is a mechanical refactor, not a rewrite.

## C. Which features survive, which need redesign?

**Work unchanged (or better):**
- Focus timer + rounds + immersive mode + scratchpad (already local-first)
- Flashcards with SM-2 (scheduler already pure), CSV import, images (as Blobs), audio-capable if ever revived
- Tasks (with filters/editing), Notes (pin/search), Sprints (schedule math is client-side), Exam countdowns
- Stats page — all aggregations are per-user math that can run on IndexedDB data
- Ambient sounds — already static files cached by the service worker
- Data export/import JSON — already built in v4, becomes the *primary* backup mechanism
- Arabic/English + RTL/LTR, theming, avatars — already localStorage-driven
- PWA install + offline shell — already there (`public/sw.js`), becomes truly offline-capable (currently the shell loads offline but the data pages show empty state because `/api/*` is never cached)

**Needs redesign:**
- **Reminders (push):** server cron + web-push disappears. Options: (1) drop; (2) notifications shown when the PWA opens (trivial); (3) Chromium-only `periodicBackgroundSync` (unreliable); (4) keep a tiny push function — but then a server remains. This is the biggest *product* trade-off, not a technical blocker.
- **Quran radio:** the `<audio>` element needs no CORS, so the direct HTTPS node URLs play fine. The resolver/proxy exists only because radiojar sometimes redirects to `http:` (mixed content). Without a server, the player must try the direct HTTPS mirrors (usually works) and show a clear failure state when they don't — or keep one tiny serverless function for the proxy. The recitations (mp3 downloads from quranicaudio.com) keep working; only offline replay requires caching them.
- **"Accounts":** dissolve into local profiles. See D/E.

## D. Do user accounts and data survive closing the app, losing internet, or restarting the device?

- **Closing the app / restarting the device:** yes. IndexedDB is durable and persists across sessions and reboots.
- **No internet:** yes — full functionality for everything except live radio and recitation streaming (recitations can be cached on first play).
- **Clearing site data / uninstalling the PWA:** the data is **gone** — this replaces the current risk of "forgot your account name" with "cleared your browser data". Mitigations that already exist: the JSON export button; an optional "auto-backup to file" prompt can be added.
- **Storage eviction:** browsers may evict data under disk pressure unless the app requests `navigator.storage.persist()`. Granting persistence is a one-line, standards-based fix; today's server architecture is immune to this. This is a real, honest risk on storage-constrained devices.

## E. What happens to synchronization, backups, and multi-device access?

This is where the honest trade-off lives:

- **Backups:** manual JSON export/import (already implemented in v4) works identically offline-first; it arguably becomes more reliable because it includes everything by construction.
- **Multi-device access to the same account:** **lost by default.** Data lives in one browser. A student who studies on phone and laptop would have two separate local stores.
- **Sync options if you later want it:** (1) a manual "export on this device → import on the other" flow (zero infra); (2) an optional sync service (WebDAV/S3/Supabase) added behind a `SyncAdapter` interface — real engineering work and new attack/privacy surface; (3) CRDT-based engines (Automerge/Yjs) — elegant but overkill for single-user personal data.

## F. Can hosting/deployment be simplified with static hosting?

**Yes, dramatically.**

| | Current (server-backed) | Local-first (static) |
|---|---|---|
| Hosting | Vercel (functions) or a VPS | Vercel/Netlify/Cloudflare Pages/GitHub Pages — pure static |
| Database | Turso/SQLite to maintain, back up, migrate | None |
| Deploys that can break data | Schema changes need migrations + backups | None — schema lives in code (Dexie versioned upgrades) |
| Cold starts | Lambda cold starts (libsql adapter) | None |
| Ops surface | Env vars ×6, cron, secrets, entrypoint script | None (except optional push function) |
| Cost at any scale a study app sees | $0 on free tiers — but free-tier limits/cold starts are real friction | $0, effectively unlimited static traffic |

The entire `DEPLOY.md` collapses to "deploy the `out/` folder". The migration tooling (`prisma/migrations-manual/`) and backup scripts become unnecessary.

## G. What stacks fit this product best?

| Option | Shape | Verdict |
|---|---|---|
| **1. Keep current stack** (Next.js 16 + Prisma + SQLite/Turso) | As shipped in v4 | ✅ Legitimate. Free tiers, cross-device data, real push reminders, radio proxy. Costs: two systems to keep healthy (host + DB), auth/sessions even if passwordless, latency, cold starts. |
| **2. Local-first PWA** (Next.js static export or Vite + React 19 + TS, Dexie/IndexedDB, Zustand for state, existing pure modules reused) | No server DB | ✅ **Best fit for the product's trajectory.** The v4 direction (no passwords, no gamification, local timer, local prefs) is exactly a personal discipline tool. Fastest possible UX, zero ops, true offline. Cost: reminders degraded, no cross-device sync without future work, storage-eviction risk (mitigable). |
| **3. Hybrid** (server only for push + radio proxy, data in IndexedDB) | Static app + 2 serverless functions | Possible middle ground but the worst maintenance profile: you keep a deploy pipeline *and* serverless functions *and* local storage. Reasonable only as a temporary stepping stone during migration. |
| **4. Local-first + managed sync** (Replicache/PowerSync/ElectricSQL + Postgres) | Full sync engine | ❌ Overkill: introduces the paid-service and complexity burden you explicitly excluded, for a feature (automatic multi-device sync) the product has never promised. |

---

## Comparison — the two realistic architectures

**1) Current server-backed architecture (v4 as shipped)**
- ✅ Advantages: cross-device continuity by URL login; true server push reminders; radio proxy resilience; server-side backup story; data survives browser resets.
- ❌ Disadvantages: two systems to operate; name-only auth is still an account system to explain; cold starts; day-boundary and session logic duplicated client/server (we just fixed that class of bug); every feature ships through an API layer; data breach surface exists (however small).
- 💰 Cost: $0 on free tiers; the real cost is *operational attention* (migrations, backups, tokens, cron).
- 🧭 Limits: Turso/Vercel free-tier quotas; reminder cron imprecision on Hobby plans (already documented in DEPLOY.md).

**2) Local-first, database-server-free PWA**
- ✅ Advantages: instant, fully offline, zero ops, zero marginal cost, privacy by default (data never leaves the device), the auth question dissolves entirely, the codebase shrinks (no API layer, no session model), the already-pure modules (`srs.ts`, `day.ts`, `timer-core.ts`) carry the core logic.
- ❌ Disadvantages: no automatic multi-device sync (needs future work or manual export/import); reminders degrade (no server push) — this is the sharpest product loss; radio proxy edge cases; browser-storage eviction risk without `storage.persist()`; "clear site data" becomes the data-loss event.
- 💰 Cost: $0 and simpler forever after; migration cost is the one-off (est. 2–4 focused weeks: DataStore abstraction → Dexie schema → replace API calls page by page → stats aggregation client-side → push redesign → radio fallback tuning). The UI, i18n, theming, PWA shell, and all v4 UX work carry over unchanged.
- 🧭 Limits: browser storage quotas (GBs in practice; images are the only heavy payload), `periodicBackgroundSync` is Chromium-only, iOS PWA constraints.

---

## Recommendation

**Adopt Option 2 — the local-first, database-server-free PWA — as the product's target architecture, while keeping exactly one optional serverless remnant: a radio-proxy function (and, only if reminders are judged essential, a push function alongside it).**

Reasoning, in the order that actually matters for this product:

1. **The v4 product decisions already point here.** Removing passwords removed the only reason accounts existed. Removing gamification removed the server-side event pipeline. The timer, prefs, SRS math, and day logic are already client-pure. The remaining server is a data bucket — the least valuable thing it does.
2. **The failure modes users actually feel improve.** No login at all (nothing to forget), no cold starts, offline studying that truly works, no migration/backups/ops for a solo maintainer.
3. **The loss is contained.** Multi-device sync is genuinely valuable for students, but it is *addable later* behind a `SyncAdapter` without re-architecting anything; server push reminders are the one thing that cannot be added client-side — decide consciously whether exam/due-card reminders are core. If they are, keep the two tiny functions (still static-host everything else).
4. **The migration is incremental, not a rewrite.** Introduce a `DataStore` interface; ship `LocalStore` behind a feature flag; move pages one by one; keep `RestStore` for a release or two; then delete the API layer. The risk profile is low because every module with logic is already pure and tested.

**What I would explicitly not do:** jump to a sync engine (Option 4) now, or run the hybrid (Option 3) as an end state. Both add the complexity this product just shed.

### Suggested sequence (for your approval — nothing below has been started)

1. `storage.persist()` + export hardening (1 day) — de-risks eviction immediately, valuable even on the current architecture.
2. `DataStore` abstraction over the current REST calls (2–3 days) — pure refactor, tests stay green.
3. Dexie schema + `LocalStore` behind a flag; migrate pages resource-by-resource (1–2 weeks).
4. Remove auth/`api/` layer; static export; radio fallback tuning (2–3 days).
5. Decide reminders: SW-on-open notifications first; server push only if deemed essential.

---

*Compliance note: per your final restriction, no migration or stack change was implemented in this delivery. The v4 shipped here remains the current server-backed architecture, fully working, with this document as the decision input.*

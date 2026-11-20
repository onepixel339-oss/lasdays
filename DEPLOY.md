# Last Days — Static PWA Deployment Guide

**Architecture (Stage 3 final):** a fully static Next.js 16 export. No server, no
database, no API routes, no environment variables. All user data lives in the
browser (IndexedDB via Dexie). Quran audio streams online-only from its CDN.
Any static file host serves the app — no paid backend service is required
anywhere.

---

## 1. Build

```bash
npm ci          # installs; no postinstall, no code generation
npm run build   # → next build with output: "export"
```

The complete site is written to **`out/`** (~8 MB, incl. 5.6 MB ambient sounds).
Every route is pre-rendered static HTML: `/`, `/home`, `/tasks`, `/notes`,
`/sprints`, `/srs`, `/stats`, `/focus`, `/settings`, `/quran`,
`/manifest.webmanifest`, `/robots.txt`, `404.html`, plus `sw.js` and icons.

**No environment variables are needed. No secrets exist in the repo.**

### Local static preview

```bash
npm run preview           # serves out/ on http://localhost:4173
node scripts/static-preview.mjs 3111   # custom port
```

The preview script mimics real static hosting (clean URLs, correct MIME types,
`/_next/static/*` immutable, `/sw.js` no-cache) and was the environment used for
the offline verification suite.

---

## 2. Vercel

1. Import the repo (New Project → the `local-first/offline-pwa` branch or
   whatever you promote).
2. Framework preset: **Next.js** — keep defaults (`npm run build`). Vercel
   detects `output: "export"` automatically and serves the static output.
3. No environment variables. No functions, no crons (vercel.json now contains
   only header rules — security headers + `sw.js` no-cache).
4. Deploy.

Vercel automatically serves `/home` for `home.html` (clean URLs) and every
direct route access works.

**Important:** the app requires **HTTPS** (service workers + IndexedDB
persistence). Vercel provides HTTPS by default on `*.vercel.app` and custom
domains.

## 3. Netlify

1. New site → import repo.
2. Build command: `npm run build`
3. Publish directory: **`out`**
4. Add a `_headers` file (put it in `public/_headers` so it lands in `out/`):

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
  Service-Worker-Allowed: /
```

5. Deploy. Netlify's default `pretty_urls` serves `/home` for `home.html`.

## 4. Cloudflare Pages

1. Create project → connect repo.
2. Build command: `npm run build`
3. Build output directory: **`out`**
4. Add `public/_headers` (same file as Netlify above).
5. Deploy. Cloudflare Pages automatically resolves `/home` → `home.html`
   (it tries `/home`, `home.html`, and `home/index.html`).

## 5. Any other static host / Nginx

Serve `out/` over **HTTPS** with:

- clean-URL rewrite: `/home` → `/home.html` (or `try_files $uri $uri.html $uri/index.html;` in Nginx)
- `/_next/static/*` with long-lived immutable caching (filenames are hashed)
- `/sw.js` with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`
- `audio/mpeg` for `.mp3`, `application/manifest+json` for `.webmanifest`

---

## 6. PWA installation & update behavior

- **Install:** `manifest.webmanifest` (standalone, RTL, icons 192/512 + SVG,
  shortcuts to Focus and SRS). Browsers offer "Add to Home Screen /
  Install app" on the HTTPS site. Installed PWAs are exempt from some
  browser-storage eviction policies — installing the app is recommended to
  users.
- **Update:** `sw.js` is always re-fetched (no-cache). When a new build ships,
  the browser installs the new service worker, which **waits** — the running
  app shows an update banner, and the user's reload tap applies it
  (`SKIP_WAITING`). IndexedDB is never touched during updates; only Cache
  Storage entries are versioned and swapped (`ld-static-v3` / `ld-pages-v3`).

## 7. Data location, backup, and offline behavior (user-facing facts)

- All data (profile, tasks, notes, sprints, sessions, exams, decks, cards,
  review history) lives in **IndexedDB on that device only**. No server, no
  sync, no accounts.
- Complete backup/restore: Settings → النسخ الاحتياطي والاستعادة (complete
  v3 file: everything incl. images and review history; merge or replace modes).
- Offline: the app shell + visited routes + ambient sounds are cached;
  all features work offline.
- **Quran audio is online-only by design** — never downloaded, never cached,
  never in any backup. The player says so when offline.
- Clearing site data / uninstalling deletes local data — export backups
  regularly (the app asks for persistent storage on install to reduce risk).

## 8. What is NOT needed anymore

- Node.js runtime at the host (`next start` no longer exists)
- Prisma / SQLite / Turso — deleted
- Web Push / VAPID keys — deleted (reminders are in-app)
- Vercel Crons — deleted
- Docker / VPS — deleted
- Environment variables / secrets — none

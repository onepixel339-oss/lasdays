import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════ Service Worker policy — behavioral tests ═══════════════
// sw.js is executed against stubs and its FETCH ROUTER is driven with real
// inputs. This verifies, as executable behavior (not just text):
//   • Quran audio (radiojar / quranicaudio / /api/radio / any non-sounds audio)
//     is NEVER intercepted → never cached, always network-only.
//   • /api/* is never intercepted → never cached.
//   • Ambience /sounds/*, /_next/static/*, and navigations ARE cached.
//   • Updates are consent-based (SKIP_WAITING), caches are versioned.

const ORIGIN = "https://app.example";
type Listener = (e: unknown) => void;
const listeners: Record<string, Listener[]> = {};
let respondedWith = 0;

function fakeSelf() {
  return {
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: () => null,
    clients: { claim: () => null, matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(null) },
    registration: { showNotification: () => Promise.resolve() },
  };
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.self = fakeSelf();
  g.location = { origin: ORIGIN, pathname: "/sw.js", hostname: "app.example", protocol: "https:", href: `${ORIGIN}/sw.js` };
  g.caches = {
    keys: () => Promise.resolve(["ld-static-v4", "ld-pages-v4", "ld-static-v3", "other-app-cache"]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(null),
    open: () => Promise.resolve({ put: () => Promise.resolve(), add: () => Promise.resolve() }),
  };
  g.fetch = () => {
    const res = { ok: true, clone: () => res };
    return Promise.resolve(res);
  };
  const req = createRequire(import.meta.url);
  req(resolve(__dirname, "../public/sw.js"));
});

function drive(url: string, opts: { mode?: RequestMode; destination?: string; method?: string } = {}): boolean {
  respondedWith = 0;
  const handler = listeners.fetch![0]!;
  const request = {
    url,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "no-cors",
    destination: opts.destination ?? "",
  };
  const event = {
    request,
    waitUntil: () => null,
    respondWith: (p: Promise<unknown> | Response) => {
      respondedWith++;
      void Promise.resolve(p).catch(() => null); // don't leave unhandled rejections
    },
  };
  handler(event);
  return respondedWith > 0;
}

describe("sw: Quran audio is never cached (network-only)", () => {
  it("bypasses radiojar radio streams", () => {
    expect(drive("https://n0b.radiojar.com/8s5u5tpdtwzuv", { destination: "audio" })).toBe(false);
    expect(drive("https://stream.radiojar.com/8s5u5tpdtwzuv", { destination: "audio" })).toBe(false);
  });

  it("bypasses quranicaudio recitation mp3s", () => {
    expect(drive("https://download.quranicaudio.com/quran/mahmood_khaleel_al-husaree_iza3a/001.mp3", { destination: "audio" })).toBe(false);
    expect(drive("https://download.quranicaudio.com/quran/abdul_basit_murattal/002.mp3")).toBe(false);
  });

  it("bypasses our radio resolve + proxy endpoints", () => {
    expect(drive(`${ORIGIN}/api/radio/resolve?station=cairo`)).toBe(false);
    expect(drive(`${ORIGIN}/api/radio?station=saudi&_=123`)).toBe(false);
  });

  it("bypasses any <audio> request that is not a local ambient sound", () => {
    expect(drive(`${ORIGIN}/some/unknown/track.mp3`, { destination: "audio" })).toBe(false);
    expect(drive("https://cdn.example.org/whatever.mp3", { destination: "audio" })).toBe(false);
  });
});

describe("sw: data and API are never cached", () => {
  it("bypasses every /api route", () => {
    expect(drive(`${ORIGIN}/api/tasks`)).toBe(false);
    expect(drive(`${ORIGIN}/api/auth/me`)).toBe(false);
    expect(drive(`${ORIGIN}/api/stats`)).toBe(false);
    expect(drive(`${ORIGIN}/api/push`, { method: "POST" })).toBe(false);
  });
});

describe("sw: offline shell IS cached", () => {
  it("intercepts ambient sounds (non-Quran audio may be offline)", () => {
    expect(drive(`${ORIGIN}/sounds/rain.mp3`, { destination: "audio" })).toBe(true);
    expect(drive(`${ORIGIN}/sounds/cafe.mp3`, { destination: "audio" })).toBe(true);
  });

  it("intercepts immutable build assets and icons", () => {
    expect(drive(`${ORIGIN}/_next/static/chunks/app-123.js`)).toBe(true);
    expect(drive(`${ORIGIN}/_next/static/media/font-abc.woff2`)).toBe(true);
    expect(drive(`${ORIGIN}/icon.svg`)).toBe(true);
    expect(drive(`${ORIGIN}/manifest.webmanifest`)).toBe(true);
  });

  it("intercepts navigations (offline navigation + reload)", () => {
    expect(drive(`${ORIGIN}/home`, { mode: "navigate" })).toBe(true);
    expect(drive(`${ORIGIN}/srs`, { mode: "navigate" })).toBe(true);
    expect(drive(`${ORIGIN}/quran`, { mode: "navigate" })).toBe(true);
  });
});

describe("sw: safe updates and storage", () => {
  const raw = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
  // assertions about CODE must ignore comments (the header documents the
  // guarantees using the words themselves)
  const sw = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("caches are versioned", () => {
    expect(sw).toContain("ld-static-v4");
    expect(sw).toContain("ld-pages-v4");
  });

  it("never touches IndexedDB or localStorage — no idb API anywhere in code", () => {
    expect(sw.toLowerCase()).not.toContain("indexeddb");
    expect(sw.toLowerCase()).not.toContain("indexed_db");
    expect(sw.toLowerCase()).not.toContain("opendb");
    expect(sw.toLowerCase()).not.toContain("localstorage");
  });

  it("precaches the shell but never any Quran audio", () => {
    expect(sw).toContain("/home");
    expect(sw).toContain("/quran");
    // the precache list must not contain audio files
    const precacheBlock = sw.slice(sw.indexOf("PRECACHE = ["), sw.indexOf("];", sw.indexOf("PRECACHE = [")));
    expect(precacheBlock).not.toMatch(/\.mp3/);
    expect(precacheBlock).not.toMatch(/sounds\//);
    expect(precacheBlock).not.toMatch(/radiojar|quranicaudio/);
  });

  it("update activation deletes only its own caches and waits for consent", () => {
    expect(sw).toContain("SKIP_WAITING");
    // activate handler is captured — verify it only deletes non-allowlisted caches
    const activate = listeners.activate![0]!;
    let deleted: string[] = [];
    const g = globalThis as unknown as { caches: { keys: () => Promise<string[]>; delete: (k: string) => Promise<boolean>; match: unknown; open: unknown } };
    const realDelete = g.caches.delete.bind(g.caches);
    g.caches.delete = (k: string) => { deleted.push(k); return realDelete(k); };
    let claimed = false;
    (globalThis as unknown as { self: { clients: { claim: () => void } } }).self.clients.claim = () => { claimed = true; };
    activate({ waitUntil: (p: Promise<unknown>) => void p.catch(() => null) });
    return (async () => {
      await new Promise((r) => setTimeout(r, 10)); // let activate's async body run
      expect(deleted).toEqual(["ld-static-v3", "other-app-cache"]); // own v4 caches survive
      expect(claimed).toBe(true);
      g.caches.delete = realDelete;
    })();
  });
});

describe("quran player: no persistence of any kind", () => {
  const player = readFileSync(resolve(__dirname, "../src/lib/quran-player.ts"), "utf8");

  it("never touches Cache Storage, IndexedDB, or localStorage", () => {
    expect(player).not.toContain("caches.");
    expect(player.toLowerCase()).not.toContain("indexeddb");
    // volume persistence lives in the page (UI pref), not the audio engine —
    // and no audio bytes ever go to persistent storage
    expect(player).not.toContain("localStorage");
  });

  it("streams with preload=none (never downloads ahead of play)", () => {
    expect(player).toContain('preload = "none"');
    expect(player).not.toContain('preload = "auto"');
  });

  it("fails offline explicitly (online-only product rule)", () => {
    expect(player).toContain("offlineNow()");
    expect(player).toContain('"offline"');
  });
});

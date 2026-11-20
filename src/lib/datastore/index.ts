"use client";

// ═══════════════ LocalStore — the only production data store ═══════════════
// Stage 3 (final architecture): the REST feature flag and RestStore are gone.
// All application data lives in IndexedDB via Dexie. No server, no accounts,
// no synchronization — backup/restore is the user's manual transfer path.
//
// SSR-safe: no store is constructed at module scope; LocalStore touches Dexie
// only inside its methods, which only run in the browser.

import { LocalStore } from "./local";
import type { DataStore } from "./types";

const G = globalThis as unknown as { __ldStore?: DataStore };

/** The app-wide DataStore singleton — call inside effects/handlers, never at module scope. */
export function getStore(): DataStore {
  if (!G.__ldStore) G.__ldStore = new LocalStore();
  return G.__ldStore;
}

/** Test-only: drop the cached singleton so a fresh one is built next time. */
export function resetStore(): void {
  G.__ldStore = undefined;
}

export type { DataStore };

"use client";

import { useEffect } from "react";

/** Registers the service worker (PWA offline shell) and asks the browser once
 *  to persist storage (protects IndexedDB from automatic eviction).
 *  Silent everywhere it is unsupported. */
export function SWRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    }
    try {
      if (!localStorage.getItem("ld2_persist_asked")) {
        localStorage.setItem("ld2_persist_asked", "1");
        navigator.storage?.persist?.().catch(() => null);
      }
    } catch {
      /* private mode — the Settings button still offers it */
    }
  }, []);
  return null;
}

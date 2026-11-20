"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApp } from "@/components/providers";

// ═══════════════ Safe SW updates — notify, then reload on user action ═══════════════
// A new service worker installs → waits → the user is offered a reload.
// The update NEVER touches IndexedDB (the SW only owns Cache Storage), so
// user data is safe across updates by construction.

export function SwUpdate() {
  const { t } = useApp();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.ready.then((reg) => {
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      };
      if (reg.waiting) setWaiting(reg.waiting); // updated while the tab was closed
      track(reg.installing ?? null);
      reg.addEventListener("updatefound", () => track(reg.installing ?? null));
    }).catch(() => null);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const apply = useCallback(() => {
    waiting?.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-sm" role="status">
      <RefreshCw className="size-[18px] shrink-0 text-primary" />
      <p className="min-w-0 flex-1 font-semibold leading-snug">{t("sw.updateAvailable")}</p>
      <button
        onClick={apply}
        className="shrink-0 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-transform active:scale-95 tap"
      >
        {t("sw.reload")}
      </button>
    </div>
  );
}

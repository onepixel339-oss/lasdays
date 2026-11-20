"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, dirOf, type Lang } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { getStore } from "@/lib/datastore";

// ═══════════════ App-wide client context: language, theme, user ═══════════════
// Mounted ONCE, in the root layout. Study data is fetched per-page.

export interface Me {
  id: string;
  username: string;
  isGuest: boolean;
  avatar: string;
  locale: string;
  themeMode: string;
  themeAccent: string;
}

interface AppCtx {
  ready: boolean;
  me: Me | null;
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (path: string, vars?: Record<string, string | number>) => string;
  theme: "light" | "dark";
  accent: string;
  setLang: (l: Lang) => void;
  setTheme: (m: "light" | "dark") => void;
  setAccent: (a: string) => void;
  refreshMe: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

const PREF_KEY = "ld2_prefs";

/** legacy accents → journal accents (دفتر آخر النهار) */
const ACCENT_MAP: Record<string, string> = {
  nebula: "amber",
  terracotta: "clay",
  olive: "moss",
  gold: "amber",
  sand: "dusk",
  cyan: "dusk",
  ember: "clay",
  emerald: "moss",
  rose: "wine",
};
export const mapAccent = (a: string) => ACCENT_MAP[a] ?? a;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [lang, setLangState] = useState<Lang>("ar");
  const [theme, setThemeState] = useState<"light" | "dark">("dark");
  const [accent, setAccentState] = useState("amber");

  const applyAttrs = useCallback((l: Lang, th: "light" | "dark", ac: string) => {
    const el = document.documentElement;
    el.lang = l;
    el.dir = dirOf(l);
    el.classList.toggle("dark", th === "dark");
    el.dataset.accent = ac;
  }, []);

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const user = await getStore().getProfile();
      if (user) {
        setMe(user);
        // stored prefs win if this is the first load
        if (user.locale) {
          const l = user.locale as Lang;
          const th = (user.themeMode === "light" ? "light" : "dark") as "light" | "dark";
          const ac = mapAccent(user.themeAccent || "amber");
          setLangState(l);
          setThemeState(th);
          setAccentState(ac);
          applyAttrs(l, th, ac);
          try {
            const raw = localStorage.getItem(PREF_KEY);
            const p = raw ? JSON.parse(raw) : {};
            localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, lang: l, theme: th, accent: ac }));
          } catch { /* ignore */ }
        }
        return user as Me;
      }
      setMe(null);
      return null;
    } catch {
      setMe(null);
      return null;
    } finally {
      setReady(true);
    }
  }, [applyAttrs]);

  // ── mount: local prefs are already applied by the pre-paint script; load session ──
  useEffect(() => {
    // sync React state with whatever the pre-paint script applied
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { lang?: string; theme?: string; accent?: string };
        if (p.lang === "ar" || p.lang === "en") setLangState(p.lang);
        if (p.theme === "light" || p.theme === "dark") setThemeState(p.theme);
        if (p.accent) setAccentState(mapAccent(p.accent));
      }
    } catch { /* ignore */ }
    refreshMe();
  }, [refreshMe]);

  // keep html attrs in sync when states change
  useEffect(() => {
    applyAttrs(lang, theme, accent);
  }, [lang, theme, accent, applyAttrs]);

  // ── setters: persist local + store + apply ──
  const persist = useCallback(
    (patch: Record<string, string>) => {
      try {
        const raw = localStorage.getItem(PREF_KEY);
        const p = raw ? JSON.parse(raw) : {};
        localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, ...patch }));
      } catch {
        /* ignore */
      }
      getStore().updateProfile(patch).catch(() => null);
    },
    []
  );

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      applyAttrs(l, theme, accent);
      persist({ locale: l });
    },
    [theme, accent, applyAttrs, persist]
  );

  const setTheme = useCallback(
    (m: "light" | "dark") => {
      setThemeState(m);
      applyAttrs(lang, m, accent);
      persist({ themeMode: m });
    },
    [lang, accent, applyAttrs, persist]
  );

  const setAccent = useCallback(
    (a: string) => {
      setAccentState(a);
      applyAttrs(lang, theme, a);
      persist({ themeAccent: a });
    },
    [lang, theme, applyAttrs, persist]
  );

  const logout = useCallback(async () => {
    await getStore().signOut().catch(() => null);
    setMe(null);
    toast({
      title: translate(lang, "auth.logout"),
      description: translate(lang, "common.saved"),
      duration: 2000,
    });
    router.replace("/");
  }, [router, lang, toast]);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => translate(lang, path, vars),
    [lang]
  );

  const value = useMemo<AppCtx>(
    () => ({
      ready,
      me,
      lang,
      dir: dirOf(lang),
      t,
      theme,
      accent,
      setLang,
      setTheme,
      setAccent,
      refreshMe,
      logout,
    }),
    [ready, me, lang, t, theme, accent, setLang, setTheme, setAccent, refreshMe, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

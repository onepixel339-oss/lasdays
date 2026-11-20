"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sun, Moon, Footprints, ShieldAlert, X } from "lucide-react";
import { BrandMark } from "@/components/app-shell";

// ═══════════════ Onboarding: name-only local profile (no passwords — by design) ═══════════════
// The profile row lives in IndexedDB on this device. There is no server and
// no account — the name labels the local profile.

type Mode = "login" | "signup";

const ERRORS: Record<string, string> = {
  invalid_name: "auth.shortName",
  reserved_name: "auth.reservedName",
  username_taken: "auth.usernameTaken",
  no_account: "auth.noAccount",
  too_many_requests: "auth.tooMany",
  profile_exists: "auth.profileExists",
};

export default function AuthPage() {
  const router = useRouter();
  const { ready, me, t, dir, theme, setTheme } = useApp();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(true);

  useEffect(() => {
    if (ready && me) router.replace("/home");
  }, [ready, me, router]);

  async function go(action: "login" | "signup" | "guest", username?: string) {
    setBusy(true);
    setErr(null);
    try {
      const store = getStore();
      if (action === "guest") await store.signInAsGuest();
      else if (action === "login") await store.signIn(username ?? "");
      else await store.signUp(username ?? "");
      window.location.href = "/home"; // full reload to pick the session cleanly
    } catch (e) {
      const code = (e as { code?: string }).code ?? "server_error";
      setErr(t(ERRORS[code] ?? "common.error"));
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (name.length < 3) {
      setErr(t("auth.shortName"));
      return;
    }
    void go(mode, name);
  };

  return (
    <div className="min-h-dvh paper hero-glow flex flex-col" dir={dir}>
      {/* theme toggle */}
      <div className="flex justify-end p-4">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="grid size-10 place-items-center rounded-full border border-border bg-card shadow-soft tap"
          aria-label={theme === "dark" ? t("settings.light") : t("settings.dark")}
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* brand */}
          <div className="text-center">
            <BrandMark className="mx-auto size-20" />
            <h1 className="mt-5 font-display text-4xl font-bold">{t("common.appName")}</h1>
            <p className="mt-2 text-muted-foreground">{t("auth.subtitle")}</p>
          </div>

          {/* card */}
          <div className="card-soft mt-8 p-5">
            {/* mode switch */}
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
              {(["login", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setErr(null);
                  }}
                  aria-pressed={mode === m}
                  className={`rounded-xl py-2 text-sm font-semibold transition-all tap ${
                    mode === m ? "bg-card shadow-soft text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t(`auth.${m}`)}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <div>
                <label htmlFor="auth-name" className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  {t("auth.username")}
                </label>
                <Input
                  id="auth-name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={mode === "login" ? t("auth.namePlaceholder") : t("auth.newNamePlaceholder")}
                  className="h-12 bg-background text-base"
                  autoComplete="username"
                  maxLength={24}
                  aria-describedby="auth-notice"
                />
              </div>

              {err && (
                <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {err}
                </p>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-lg text-base font-bold border-0"
              >
                {busy ? t("common.loading") : t(`auth.${mode}`)}
              </Button>
            </form>

            {/* honest disclosure — data lives on this device */}
            {noticeOpen && (
              <div
                id="auth-notice"
                role="note"
                className="mt-4 flex gap-2.5 rounded-2xl border border-warning/40 bg-warning/10 p-3"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-warning">
                    {t("auth.localNoticeTitle")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                    {t("auth.localNoticeBody")}
                  </p>
                </div>
                <button
                  onClick={() => setNoticeOpen(false)}
                  className="grid size-7 shrink-0 place-items-center self-start rounded-md text-muted-foreground hover:bg-accent tap"
                  aria-label={t("common.close")}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              {t("auth.or")}
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void go("guest")}
              className="w-full h-12 gap-2 rounded-lg font-semibold"
            >
              <Footprints className="size-4" /> {t("auth.guest")}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">{t("auth.guestNote")}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

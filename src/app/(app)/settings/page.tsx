"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { AVATAR_TINTS, AVATAR_TINT_HEX, avatarTintOf, initialOf } from "@/i18n";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackupRestore } from "@/components/backup-restore";
import { APP_VERSION } from "@/lib/backup";
import {
  UserRound, Sun, Moon, Globe, LogOut, Footprints, Palette, Bell,
  ShieldAlert, Pencil, Check, HardDrive,
} from "lucide-react";

// ═══════════════ Settings — مجموعات تفضيلات · دفتر آخر النهار ═══════════════
// Preference groups, not another content page: each group shows its current
// value next to the title. Fully local: profile + data live in IndexedDB;
// backups go through BackupRestore (complete v3 backup). Reminders are
// in-app only. Accents are warm journal hues — amber is the identity default.

const ACCENTS = [
  { key: "amber", hex: "#A84F2B" },
  { key: "moss", hex: "#3D6B54" },
  { key: "clay", hex: "#7A5230" },
  { key: "dusk", hex: "#44586E" },
  { key: "wine", hex: "#7C3E52" },
];

export default function SettingsPage() {
  const { t, lang, dir, theme, accent, setLang, setTheme, setAccent, me, refreshMe, logout } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);

  // ── local storage info (IndexedDB quota + persistence) ──
  useEffect(() => {
    navigator.storage?.estimate?.().then((est) => {
      navigator.storage?.persisted?.().then((persisted) => {
        setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
      }).catch(() => null);
    }).catch(() => null);
  }, []);

  async function requestPersist() {
    try {
      const granted = (await navigator.storage?.persist?.()) ?? false;
      setStorage((s) => (s ? { ...s, persisted: granted } : s));
    } catch { /* not supported — the hint text stays visible */ }
  }

  const fmtBytes = (n: number) => {
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${n} B`;
  };

  // ── account name (claim guest / rename) ──
  async function saveName() {
    const name = newName.trim();
    if (name.length < 3) { setNameErr(t("auth.shortName")); return; }
    try {
      await getStore().renameProfile(name);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setNameErr(t(code === "username_taken" || code === "profile_exists" ? "auth.usernameTaken" : "auth.shortName"));
      return;
    }
    setRenaming(false);
    setNameErr(null);
    await refreshMe();
  }

  async function setAvatar(a: string) {
    await getStore().updateProfile({ avatar: a }).catch(() => null);
    await refreshMe();
  }

  return (
    <div className="space-y-6 pb-4" dir={dir}>
      <h1 className="font-display text-2xl font-bold">{t("settings.title")}</h1>

      {/* ── profile ── */}
      <section className="card-soft overflow-hidden">
        <GroupHeader icon={<UserRound className="size-4" />} title={t("settings.profile")} />
        <div className="px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-xl font-display text-xl font-bold"
              style={{
                background: AVATAR_TINT_HEX[avatarTintOf(me?.avatar)],
                color: "#FFFEFA",
                boxShadow: "inset 0 0 0 1px rgba(255,254,250,0.18)",
              }}
              aria-hidden
            >
              {initialOf(me?.isGuest && me?.username.startsWith("guest_") ? t("auth.guestName") : me?.username)}
            </span>
            <div className="min-w-0 flex-1">
              {renaming ? (
                <div className="space-y-2">
                  <Input
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setNameErr(null); }}
                    placeholder={t("auth.username")}
                    maxLength={24}
                    className="h-11 bg-background"
                    aria-label={t("auth.username")}
                    autoFocus
                  />
                  {nameErr && <p className="text-xs text-destructive" role="alert">{nameErr}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveName} className="rounded-lg px-4 font-bold">
                      <Check className="size-4" /> {t("common.save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(false)} className="rounded-lg">
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="truncate font-bold">
                    {me?.isGuest && me?.username.startsWith("guest_") ? t("auth.guestName") : me?.username}
                  </p>
                  <button
                    onClick={() => { setRenaming(true); setNewName(me?.isGuest ? "" : (me?.username ?? "")); setNameErr(null); }}
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent tap"
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              )}
              {me?.isGuest && !renaming && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Footprints className="size-3" /> {t("settings.guestNotice")}
                </p>
              )}
            </div>
          </div>
          <p className="mt-4 text-xs font-semibold text-muted-foreground">{t("settings.avatarTint")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVATAR_TINTS.map((key) => (
              <button
                key={key}
                onClick={() => setAvatar(key)}
                aria-pressed={avatarTintOf(me?.avatar) === key}
                aria-label={t(`settings.${key}`)}
                className={`grid size-11 place-items-center rounded-xl border transition-transform tap ${
                  avatarTintOf(me?.avatar) === key
                    ? "scale-105 border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span
                  className="size-6 rounded-full"
                  style={{
                    background: AVATAR_TINT_HEX[key],
                    ...(avatarTintOf(me?.avatar) === key ? { boxShadow: "0 0 0 2px var(--card), 0 0 0 3px var(--primary)" } : {}),
                  }}
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── appearance — current theme + accent visible at a glance ── */}
      <section className="card-soft overflow-hidden">
        <GroupHeader
          icon={<Palette className="size-4" />}
          title={t("settings.appearance")}
          value={
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              {theme === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {t(`settings.${theme}`)}
            </span>
          }
        />
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-muted-foreground">{t("settings.theme")}</p>
          <div className="mt-2 grid max-w-sm grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["light", "dark"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                aria-pressed={theme === m}
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition-colors tap ${
                  theme === m ? "bg-card font-bold text-foreground shadow-soft" : "text-muted-foreground"
                }`}
              >
                {m === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />} {t(`settings.${m}`)}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs font-semibold text-muted-foreground">{t("settings.accent")}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAccent(a.key)}
                aria-pressed={accent === a.key}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors tap ${
                  accent === a.key ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="size-5 shrink-0 rounded-full"
                  style={{
                    background: a.hex,
                    ...(accent === a.key ? { boxShadow: "0 0 0 2px var(--card), 0 0 0 3.5px var(--primary)" } : {}),
                  }}
                  aria-hidden
                />
                {t(`settings.${a.key}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── language / direction ── */}
      <section className="card-soft overflow-hidden">
        <GroupHeader
          icon={<Globe className="size-4" />}
          title={t("settings.language")}
          value={<span className="text-xs font-semibold text-muted-foreground">{lang === "ar" ? "العربية · RTL" : "English · LTR"}</span>}
        />
        <div className="px-5 py-4">
          <div className="grid max-w-sm grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`min-h-10 rounded-md py-2 text-sm font-semibold transition-colors tap ${
                  lang === l ? "bg-card font-bold text-foreground shadow-soft" : "text-muted-foreground"
                }`}
              >
                {l === "ar" ? "العربية" : "English"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* notifications — in-app reminders only; no server, no web push */}
      <section className="card-soft overflow-hidden">
        <GroupHeader icon={<Bell className="size-4" />} title={t("settings.notifications")} />
        <p className="px-5 py-4 text-xs leading-relaxed text-muted-foreground">
          {t("settings.notifLocalDesc")}
        </p>
      </section>

      {/* ── data + backup & restore ── */}
      <section className="card-soft overflow-hidden">
        <GroupHeader
          icon={<HardDrive className="size-4" />}
          title={t("settings.data")}
          value={storage ? <span className="text-xs font-semibold text-muted-foreground num-tabular">{fmtBytes(storage.usage)}</span> : undefined}
        />
        <div className="px-5 py-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <HardDrive className="size-3.5 shrink-0" />
            {t("settings.storageLocal")}
          </p>
          {storage && (
            <div className="mt-2 rounded-lg bg-secondary p-3.5 text-xs">
              <p className="num-tabular font-semibold">
                {t("settings.storageUsed", { n: fmtBytes(storage.usage), q: fmtBytes(storage.quota) })}
              </p>
              {storage.persisted ? (
                <p className="mt-1 font-semibold text-success">{t("settings.storagePersisted")}</p>
              ) : (
                <button onClick={requestPersist} className="mt-1 font-bold text-primary underline underline-offset-2 tap">
                  {t("settings.storagePersist")}
                </button>
              )}
              <p className="mt-1.5 leading-relaxed text-muted-foreground">{t("settings.storageHint")}</p>
            </div>
          )}
        </div>
      </section>
      <BackupRestore />

      {/* ── account ── */}
      <section className="card-soft overflow-hidden">
        <GroupHeader icon={<ShieldAlert className="size-4" />} title={t("settings.account")} />
        <div className="px-5 py-4">
          <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-xs leading-relaxed text-foreground/80">
              {t("auth.localNoticeBody")}
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => { if (confirm(t("settings.logoutConfirm"))) logout(); }}
            className="mt-4 h-11 w-full gap-1.5 rounded-lg font-bold"
          >
            <LogOut className="size-4" /> {t("settings.logout")}
          </Button>
        </div>
      </section>

      {/* about */}
      <section className="rounded-lg border border-dashed border-border p-5 text-center">
        <p className="font-display text-lg font-bold">{t("common.appName")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("common.tagline")} · v{APP_VERSION}</p>
      </section>
    </div>
  );
}

/** Group header — icon, title, and the current value sitting quietly at the end. */
function GroupHeader({ icon, title, value }: { icon: React.ReactNode; title: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">{icon}</span>
      <h2 className="min-w-0 flex-1 font-display text-base font-bold">{title}</h2>
      {value}
    </div>
  );
}

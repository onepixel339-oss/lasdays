"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, CircleCheckBig, GraduationCap, BookOpen, X, WifiOff } from "lucide-react";
import { useApp } from "@/components/providers";
import { collectReminders, remindersGateKey, type ReminderItem } from "@/lib/reminders";
import { getStore } from "@/lib/datastore";

// ═══════════════ Reminders bar — in-app reminders, shown when the app opens ═══════════════
// Replaces server Web Push in the local-first app: computed from the user's own
// data, shown once per day (Cairo calendar), dismissible until tomorrow.

const TONE_CLASS: Record<ReminderItem["tone"], string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

const ICON: Record<string, React.ElementType> = {
  dueCards: Brain,
  dueOne: Brain,
  overdue: CircleCheckBig,
  overdueOne: CircleCheckBig,
  examToday: GraduationCap,
  examSoon: GraduationCap,
  examSoonOne: GraduationCap,
  sprintBehind: BookOpen,
};

export function RemindersBar() {
  const { t, ready, me } = useApp();
  const [items, setItems] = useState<ReminderItem[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!ready || !me) return;
    let alive = true;
    // once per Cairo day — a dismissal silences it until tomorrow
    let gated = false;
    try {
      gated = localStorage.getItem(remindersGateKey()) === "1";
    } catch { /* ignore */ }
    (gated ? Promise.resolve(null) : collectReminders(getStore()))
      .then((r) => { if (alive) setItems(r ?? []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [ready, me]);

  const dismiss = () => {
    setItems([]);
    try { localStorage.setItem(remindersGateKey(), "1"); } catch { /* ignore */ }
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" role="region" aria-label={t("reminders.title")}>
      {offline && (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/50 px-3.5 py-2.5 text-xs font-semibold text-muted-foreground">
          <WifiOff className="size-3.5 shrink-0" />
          {t("reminders.offlineReady")}
        </div>
      )}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-bold text-muted-foreground">{t("reminders.title")}</p>
        <button
          onClick={dismiss}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent tap"
        >
          <X className="size-3" /> {t("reminders.dismiss")}
        </button>
      </div>
      <ul className="space-y-1.5">
        {items.map((r, i) => {
          const Icon = ICON[r.key] ?? Brain;
          const cta = r.key.startsWith("due")
            ? t("reminders.goToReview")
            : r.key.startsWith("overdue")
              ? t("reminders.goToTasks")
              : r.key === "sprintBehind" ? t("nav.sprint") : t("reminders.goToExam");
          return (
            <li key={i}>
              <Link
                href={r.href}
                onClick={dismiss}
                className={`flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold shadow-soft transition-transform active:scale-[0.99] tap ${TONE_CLASS[r.tone]}`}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1 leading-snug">{t(`reminders.${r.key}`, r.vars)}</span>
                <span className="shrink-0 text-[11px] font-bold opacity-70">{cta} ›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

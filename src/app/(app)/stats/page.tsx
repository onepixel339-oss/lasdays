"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Brain, CircleCheckBig, TrendingDown, TrendingUp, BarChart3 } from "lucide-react";

// ═══════════════ Stats — ملخص الأسبوع · دفتر آخر النهار ═══════════════
// The weekly summary answers "how did the week go" in one glance: focused
// time, consistency, all-time totals — then ONE primary chart (weekly bars,
// values labeled in minutes), then the by-subject breakdown and the activity
// trail. Metrics carry their units; meaning is never color-only.

interface StatsData {
  week: { day: string; minutes: number }[];
  heat: { day: string; minutes: number }[];
  bySubject: { subject: string; minutes: number }[];
  weekBySubject: { subject: string; minutes: number }[];
  totals: {
    focusMinutes: number; sessions: number; reviews: number; doneTasks: number;
  };
  weekCompare: { this: number; last: number };
}

export default function StatsPage() {
  const { t, lang, dir } = useApp();
  const [data, setData] = useState<StatsData | null>(null);
  const [subjRange, setSubjRange] = useState<"week" | "all">("week");

  useEffect(() => {
    getStore().getStats().then(setData).catch(() => null);
  }, []);

  if (!data) {
    return (
      <div className="grid min-h-[50vh] place-items-center" dir={dir}>
        <BarChart3 className="size-8 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  const weekTotal = data.week.reduce((a, w) => a + w.minutes, 0);
  const consistentDays = data.week.filter((w) => w.minutes > 0).length;
  const weekMax = Math.max(60, ...data.week.map((w) => w.minutes));
  const dayNames = lang === "ar"
    ? ["ح", "ن", "ث", "ر", "خ", "ج", "س"]
    : ["S", "M", "T", "W", "T", "F", "S"];
  const delta = data.weekCompare.this - data.weekCompare.last;
  const deltaText =
    data.weekCompare.last === 0 || delta === 0
      ? t("stats.sameAsLast")
      : delta > 0
        ? t("stats.moreThanLast", { n: delta })
        : t("stats.lessThanLast", { n: Math.abs(delta) });

  // heatmap — group into columns of 7 (weeks), newest last
  const weeks: { day: string; minutes: number }[][] = [];
  for (let i = 0; i < data.heat.length; i += 7) weeks.push(data.heat.slice(i, i + 7));
  const heatMax = Math.max(30, ...data.heat.map((h) => h.minutes));

  const heatColor = (m: number) => {
    if (m === 0) return "var(--muted)";
    const a = 0.25 + 0.75 * Math.min(1, m / heatMax);
    return `color-mix(in srgb, var(--primary) ${Math.round(a * 100)}%, var(--muted))`;
  };

  const hourFmt = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)}${lang === "ar" ? "س" : "h"} ${m % 60 ? `${m % 60}${lang === "ar" ? "د" : "m"}` : ""}` : `${m}${lang === "ar" ? "د" : "m"}`;

  return (
    <div className="space-y-6" dir={dir}>
      <h1 className="font-display text-2xl font-bold">{t("stats.title")}</h1>

      {/* ── weekly summary — the one glance that answers "how did the week go" ── */}
      <section className="card-soft">
        <h2 className="border-b border-border px-5 py-3 font-display text-base font-bold">{t("stats.weekSummary")}</h2>
        <div className="grid grid-cols-1 divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-muted-foreground">{t("stats.focusLabel")}</p>
            <p className="mt-1 font-display text-2xl font-bold num-tabular">{hourFmt(weekTotal)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {delta > 0 && data.weekCompare.last > 0 ? (
                <TrendingUp className="size-3.5 text-success" aria-hidden />
              ) : delta < 0 && data.weekCompare.last > 0 ? (
                <TrendingDown className="size-3.5 text-destructive" aria-hidden />
              ) : null}
              <span className="num-tabular">{deltaText}</span>
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-muted-foreground">{t("stats.consistency")}</p>
            <p className="mt-1 font-display text-2xl font-bold num-tabular">
              {consistentDays}<span className="text-base font-semibold text-muted-foreground">/7</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("common.days")}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-muted-foreground">{t("stats.totalHours")}</p>
            <p className="mt-1 font-display text-2xl font-bold num-tabular">{hourFmt(data.totals.focusMinutes)}</p>
            <p className="mt-1 text-xs text-muted-foreground num-tabular">
              {t("stats.totalSessions")}: {data.totals.sessions}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 num-tabular">
            <Brain className="size-3.5" /> {t("stats.totalCards")}: {data.totals.reviews}
          </span>
          <span className="flex items-center gap-1.5 num-tabular">
            <CircleCheckBig className="size-3.5" /> {t("stats.tasksDone")}: {data.totals.doneTasks}
          </span>
        </div>
      </section>

      {/* ── the primary chart — weekly focus, minutes on every bar ── */}
      <section className="card-soft p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-base font-bold">{t("stats.weeklyFocus")}</h2>
          <span className="text-xs text-muted-foreground">{t("stats.minutesAxis")}</span>
        </div>
        <div className="mt-4 flex h-40 items-end gap-2 sm:gap-3">
          {data.week.map((w, i) => {
            const h = Math.round((w.minutes / weekMax) * 100);
            const isToday = i === 6;
            return (
              <div key={w.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground num-tabular">{w.minutes > 0 ? w.minutes : "–"}</span>
                <div className="flex h-full w-full items-end overflow-hidden rounded-lg bg-muted/60">
                  <div
                    className={`w-full rounded-lg transition-[height] duration-500 ease-out ${isToday ? "bg-primary" : "bg-primary/50"}`}
                    style={{ height: `${Math.max(h, w.minutes > 0 ? 6 : 2)}%` }}
                    role="img"
                    aria-label={`${dayNames[i]}: ${w.minutes}`}
                  />
                </div>
                <span className={`text-xs font-semibold ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                  {dayNames[i]}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── by subject — the breakdown that guides "what next" ── */}
      {(subjRange === "week" ? data.weekBySubject.length > 0 : data.bySubject.length > 0) && (
        <section className="card-soft p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">{lang === "ar" ? "حسب المادة" : "By subject"}</h2>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["week", "all"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setSubjRange(k)}
                  aria-pressed={subjRange === k}
                  className={`min-h-9 rounded-md px-3 py-1 text-xs font-bold transition-colors tap ${
                    subjRange === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"
                  }`}
                >
                  {t(k === "week" ? "stats.byWeek" : "stats.byAll")}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(subjRange === "week" ? data.weekBySubject : data.bySubject).map((s, _, arr) => {
              const max = arr[0]?.minutes || 1;
              return (
                <div key={s.subject} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm font-medium">{s.subject}</span>
                  <div className="h-2.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70 transition-[width] duration-500" style={{ width: `${(s.minutes / max) * 100}%` }} />
                  </div>
                  <span className="w-14 text-end text-xs text-muted-foreground num-tabular">{hourFmt(s.minutes)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── the activity trail — secondary ── */}
      <section className="card-soft p-5">
        <h2 className="font-display text-base font-bold">{t("stats.heatmap")}</h2>
        <div className="mt-4 flex gap-1 overflow-x-auto pb-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((d) => (
                <div
                  key={d.day}
                  title={`${d.day} · ${d.minutes}${lang === "ar" ? "د" : "m"}`}
                  className="size-3 rounded-[4px]"
                  style={{ background: heatColor(d.minutes) }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t("common.empty")}</span>
          {[0, 0.25, 0.5, 0.75, 1].map((a) => (
            <span key={a} className="size-3 rounded-[4px]"
              style={{ background: a === 0 ? "var(--muted)" : `color-mix(in srgb, var(--primary) ${Math.round((0.25 + 0.75 * a) * 100)}%, var(--muted))` }} />
          ))}
          <TrendingUp className="size-3.5 text-primary" aria-hidden />
          <span>{t("stats.focusLabel")}</span>
        </div>
      </section>
    </div>
  );
}

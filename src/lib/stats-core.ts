// ═══════════════ Stats aggregation — pure, client-safe, server-identical ═══════════════
// Reproduces GET /api/stats EXACTLY (same windows, same Cairo-day grouping, same
// ordering) from raw records, so LocalStore and the REST route agree on every number.
// Pure function — fully unit-testable.

import { cairoDayOf, shiftDay, todayCairo } from "@/lib/day";
import type { StatsData } from "@/lib/datastore/types";

/** Minimal session shape the aggregation needs (ISO `startedAt`, like the wire). */
export interface SessionLike {
  startedAt: string;
  durationSec: number;
  subject: string | null;
}

const WINDOW_DAYS = 120;

/**
 * @param focusSessions  ALL completed focus sessions (all-time — the server's
 *                       bySubject groupBy has no time window; the 120-day window
 *                       is applied inside).
 * @param reviewCount    all-time review-log count
 * @param doneTasks      all-time done-task count
 */
export function computeStats(
  focusSessions: SessionLike[],
  reviewCount: number,
  doneTasks: number,
  now: Date = new Date()
): StatsData {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000);

  // sessions inside the 120-day window (server: startedAt >= since)
  const windowed = focusSessions.filter((s) => new Date(s.startedAt) >= since);

  // ── per-day minutes (Cairo tz) ──
  const byDay: Record<string, number> = {};
  let totalMin = 0;
  for (const s of windowed) {
    const d = cairoDayOf(new Date(s.startedAt));
    const m = Math.round(s.durationSec / 60);
    byDay[d] = (byDay[d] ?? 0) + m;
    totalMin += m;
  }

  // last 7 days array
  const today = todayCairo(now);
  const week: { day: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(today, -i);
    week.push({ day: d, minutes: byDay[d] ?? 0 });
  }

  // heatmap — last 90 days
  const heat: { day: string; minutes: number }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = shiftDay(today, -i);
    heat.push({ day: d, minutes: byDay[d] ?? 0 });
  }

  // last week total for comparison
  const thisWeekMin = week.reduce((a, w) => a + w.minutes, 0);
  let lastWeekMin = 0;
  for (let i = 13; i >= 7; i--) {
    const d = shiftDay(today, -i);
    lastWeekMin += byDay[d] ?? 0;
  }

  // weekly by-subject — from the last-7-days sessions
  const weekDays = new Set(week.map((w) => w.day));
  const weekBySubjectMap: Record<string, number> = {};
  for (const s of windowed) {
    const day = cairoDayOf(new Date(s.startedAt));
    if (!weekDays.has(day)) continue;
    const k = s.subject ?? "—";
    weekBySubjectMap[k] = (weekBySubjectMap[k] ?? 0) + Math.round(s.durationSec / 60);
  }
  const weekBySubject = Object.entries(weekBySubjectMap)
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // all-time by-subject (no window — mirrors the server groupBy)
  const allSubjectMap: Record<string, number> = {};
  for (const s of focusSessions) {
    const k = s.subject ?? "—";
    allSubjectMap[k] = (allSubjectMap[k] ?? 0) + (s.durationSec ?? 0);
  }
  const bySubject = Object.entries(allSubjectMap)
    .map(([subject, sec]) => ({ subject, minutes: Math.round(sec / 60) }));

  return {
    week,
    heat,
    bySubject,
    weekBySubject,
    totals: {
      focusMinutes: totalMin,
      sessions: windowed.length,
      reviews: reviewCount,
      doneTasks,
    },
    weekCompare: { this: thisWeekMin, last: lastWeekMin },
  };
}

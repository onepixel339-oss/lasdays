import { describe, it, expect } from "vitest";
import { computeStats, type SessionLike } from "@/lib/stats-core";

// ═══════════════ computeStats must reproduce GET /api/stats exactly ═══════════════
// The server: 120-day window for sessions/totals; bySubject has NO window
// (all-time); week = last 7 Cairo days; heat = last 90; weekCompare = this vs
// previous 7-day block; weekBySubject sorted desc.

function iso(daysAgo: number, _hour = 10): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
  // _hour intentionally unused — Cairo day grouping is calendar-exact
}

const NOW = new Date();

describe("computeStats", () => {
  it("returns week (7) and heat (90) arrays with correct day counts", () => {
    const s = computeStats([], 0, 0, NOW);
    expect(s.week).toHaveLength(7);
    expect(s.heat).toHaveLength(90);
    // week[6] is today (i=6 → oldest), heat[89] is today
    expect(s.week[6]!.day).toBe(s.heat[89]!.day);
    expect(s.week.every((w) => w.minutes === 0)).toBe(true);
  });

  it("aggregates minutes per Cairo day and computes totals inside the 120d window", () => {
    const sessions: SessionLike[] = [
      { startedAt: iso(0), durationSec: 1500, subject: "فيزياء" }, // 25 min
      { startedAt: iso(0), durationSec: 600, subject: null }, // 10 min → subject "—"
      { startedAt: iso(3), durationSec: 3600, subject: "فيزياء" }, // 60 min
      { startedAt: iso(200), durationSec: 6000, subject: "old" }, // outside 120d
    ];
    const s = computeStats(sessions, 0, 0, NOW);
    expect(s.totals.focusMinutes).toBe(95); // 25+10+60 — the 200d session excluded
    expect(s.totals.sessions).toBe(3);
    const todayRow = s.week.find((w) => w.day === s.week[6]!.day)!;
    expect(todayRow.minutes).toBe(35); // 25 + 10
  });

  it("bySubject is ALL-TIME (no window) while totals respect the 120d window", () => {
    const sessions: SessionLike[] = [
      { startedAt: iso(200), durationSec: 6000, subject: "old" }, // 100 min, outside window
    ];
    const s = computeStats(sessions, 0, 0, NOW);
    expect(s.totals.focusMinutes).toBe(0);
    expect(s.bySubject).toEqual([{ subject: "old", minutes: 100 }]);
  });

  it("weekBySubject covers the last 7 days only and sorts desc", () => {
    const sessions: SessionLike[] = [
      { startedAt: iso(0), durationSec: 1800, subject: "A" }, // 30
      { startedAt: iso(1), durationSec: 3600, subject: "B" }, // 60
      { startedAt: iso(10), durationSec: 9000, subject: "A" }, // 150 — outside week
    ];
    const s = computeStats(sessions, 0, 0, NOW);
    expect(s.weekBySubject).toEqual([
      { subject: "B", minutes: 60 },
      { subject: "A", minutes: 30 },
    ]);
  });

  it("weekCompare splits this week vs the previous one", () => {
    const sessions: SessionLike[] = [
      { startedAt: iso(0), durationSec: 600, subject: null }, // this week: 10
      { startedAt: iso(10), durationSec: 1200, subject: null }, // last week: 20
    ];
    const s = computeStats(sessions, 0, 0, NOW);
    expect(s.weekCompare.this).toBe(10);
    expect(s.weekCompare.last).toBe(20);
  });

  it("passes review and task counters straight through", () => {
    const s = computeStats([], 42, 7, NOW);
    expect(s.totals.reviews).toBe(42);
    expect(s.totals.doneTasks).toBe(7);
  });
});

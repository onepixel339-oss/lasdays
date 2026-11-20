import { describe, it, expect } from "vitest";
import { schedule, previewInterval, readiness, type SchedState } from "@/lib/srs";

describe("schedule — SM-2 learning steps", () => {
  const fresh: SchedState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

  it("first 'good' → 1 day, first 'easy' → 3 days, first 'hard' → half day", () => {
    expect(schedule(fresh, "good").intervalDays).toBe(1);
    expect(schedule(fresh, "easy").intervalDays).toBe(3);
    expect(schedule(fresh, "hard").intervalDays).toBe(0.5);
  });

  it("'again' → 10 minutes and a lapse", () => {
    const r = schedule(fresh, "again");
    expect(r.intervalDays).toBe(0);
    expect(r.lapses).toBe(1);
    const dueIn = r.dueAt.getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(9 * 60_000 - 5000);
    expect(dueIn).toBeLessThanOrEqual(10 * 60_000);
  });

  it("ease floors at 1.3 after repeated 'again'", () => {
    let s: SchedState = { ...fresh };
    for (let i = 0; i < 10; i++) {
      s = schedule(s, "again");
    }
    expect(s.ease).toBe(1.3);
  });
});

describe("schedule — review steps", () => {
  const reviewing: SchedState = { ease: 2.5, intervalDays: 10, reps: 3, lapses: 0 };

  it("'good' multiplies the interval by ease", () => {
    const r = schedule(reviewing, "good");
    expect(r.intervalDays).toBeCloseTo(25);
  });

  it("'hard' grows slowly and lowers ease", () => {
    const r = schedule(reviewing, "hard");
    expect(r.ease).toBeCloseTo(2.35);
    expect(r.intervalDays).toBeGreaterThanOrEqual(10.5);
    expect(r.intervalDays).toBeLessThanOrEqual(12);
  });

  it("'easy' boosts ease and interval with a 1.3 bonus", () => {
    const r = schedule(reviewing, "easy");
    expect(r.ease).toBeCloseTo(2.65);
    expect(r.intervalDays).toBeCloseTo(10 * 2.65 * 1.3, 1);
  });

  it("intervals never exceed a year", () => {
    const big: SchedState = { ease: 3.2, intervalDays: 360, reps: 20, lapses: 0 };
    expect(schedule(big, "easy").intervalDays).toBeLessThanOrEqual(365);
  });
});

describe("previewInterval", () => {
  it("labels intervals for the answer buttons", () => {
    const fresh: SchedState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };
    expect(previewInterval(fresh, "again")).toBe("10m");
    expect(previewInterval(fresh, "hard")).toBe("12h");
    expect(previewInterval(fresh, "good")).toBe("1d");
    expect(previewInterval(fresh, "easy")).toBe("3d");
    expect(previewInterval({ ease: 2.5, intervalDays: 10, reps: 3, lapses: 0 }, "good")).toBe("25d");
  });
});

describe("readiness", () => {
  it("mature cards weigh full, young cards weigh half", () => {
    expect(readiness([])).toBe(0);
    expect(readiness([{ intervalDays: 10, reps: 3 }])).toBe(100);
    expect(readiness([{ intervalDays: 2, reps: 1 }])).toBe(50);
    expect(readiness([
      { intervalDays: 10, reps: 3 },
      { intervalDays: 2, reps: 1 },
    ])).toBe(75);
  });
});

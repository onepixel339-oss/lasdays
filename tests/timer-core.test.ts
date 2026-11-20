import { describe, it, expect } from "vitest";
import {
  freshTimer, remainingMs, elapsedFocusMs, startTimer, pauseTimer, finishPhase,
  skipPhase, switchPhase, resetPhase, isExpired, clampMinutes, clampState,
  type TimerState,
} from "@/lib/timer-core";

const MIN = 60_000;

describe("freshTimer", () => {
  it("starts idle in the focus phase with defaults", () => {
    const s = freshTimer();
    expect(s.phase).toBe("focus");
    expect(s.running).toBe(false);
    expect(s.round).toBe(1);
    expect(s.durations).toEqual({ focus: 25, short: 5, long: 15 });
    expect(remainingMs(s, 0)).toBe(25 * MIN);
  });
});

describe("start/pause", () => {
  it("anchors the countdown to wall-clock time (drift-free)", () => {
    let s = freshTimer();
    const t0 = 1_000_000;
    s = startTimer(s, t0);
    expect(s.running).toBe(true);
    expect(s.endsAt).toBe(t0 + 25 * MIN);
    // 10 minutes pass on the wall clock
    expect(remainingMs(s, t0 + 10 * MIN)).toBe(15 * MIN);
  });

  it("accumulates only actually-running focus time across pauses", () => {
    let s = freshTimer();
    const t0 = 0;
    s = startTimer(s, t0);
    // study 10 min, pause 30 min (wall), resume, study 5 more
    s = pauseTimer(s, t0 + 10 * MIN);
    expect(elapsedFocusMs(s, t0 + 40 * MIN)).toBe(10 * MIN); // paused time not counted
    s = startTimer(s, t0 + 40 * MIN);
    expect(elapsedFocusMs(s, t0 + 45 * MIN)).toBe(15 * MIN);
    expect(remainingMs(s, t0 + 45 * MIN)).toBe(10 * MIN); // 15 of 25 min elapsed
  });

  it("pause is idempotent and start while running is a no-op", () => {
    let s = startTimer(freshTimer(), 0);
    const afterStart = startTimer(s, 1000);
    expect(afterStart.endsAt).toBe(s.endsAt);
    const paused = pauseTimer(s, 1000);
    const pausedAgain = pauseTimer(paused, 2000);
    expect(pausedAgain).toEqual(paused);
    s = pausedAgain;
  });
});

describe("finishPhase", () => {
  it("a completed focus phase logs its planned duration and advances to a short break", () => {
    let s = startTimer(freshTimer(), 0);
    // tick fires 2s late
    const t = 25 * MIN + 2_000;
    const { state: ns, loggedFocusSec } = finishPhase(s, t, "completed");
    expect(loggedFocusSec).toBe(25 * 60); // capped at planned — no overshoot
    expect(ns.phase).toBe("short");
    expect(ns.running).toBe(false);
    expect(ns.round).toBe(2);
    expect(remainingMs(ns, t)).toBe(5 * MIN);
    void s;
  });

  it("round N (multiple of roundsBefore) advances to a long break", () => {
    let s: TimerState = { ...freshTimer(), round: 4 };
    s = startTimer(s, 0);
    const { state: ns } = finishPhase(s, 25 * MIN, "completed");
    expect(ns.phase).toBe("long");
    expect(ns.round).toBe(5);
  });

  it("completing a break returns to focus without logging a session", () => {
    let s: TimerState = { ...freshTimer(), phase: "short" };
    s = startTimer(s, 0);
    const { state: ns, loggedFocusSec } = finishPhase(s, 5 * MIN, "completed");
    expect(loggedFocusSec).toBeNull();
    expect(ns.phase).toBe("focus");
  });

  it("skip logs real elapsed focus time, not the preset", () => {
    let s = freshTimer();
    s = startTimer(s, 0);
    s = pauseTimer(s, 7 * MIN + 30_000); // studied 7.5 min
    const { state: ns, loggedFocusSec } = skipPhase(s, 999 * MIN);
    expect(loggedFocusSec).toBe(7 * 60 + 30);
    expect(ns.phase).toBe("short");
    expect(ns.focusElapsedMs).toBe(0); // reset for the next phase
  });

  it("skip with zero elapsed focus logs zero", () => {
    const s = freshTimer();
    const { loggedFocusSec } = skipPhase(s, 1000);
    expect(loggedFocusSec).toBe(0);
  });

  it("skipping a break logs nothing", () => {
    const s: TimerState = { ...freshTimer(), phase: "long" };
    const { loggedFocusSec, state: ns } = skipPhase(s, 1000);
    expect(loggedFocusSec).toBeNull();
    expect(ns.phase).toBe("focus");
  });
});

describe("isExpired / restore", () => {
  it("detects a phase whose wall-clock end passed", () => {
    const s = startTimer(freshTimer(), 0);
    expect(isExpired(s, 25 * MIN - 1)).toBe(false);
    expect(isExpired(s, 25 * MIN)).toBe(true);
  });

  it("an expired phase completed while away logs the planned duration", () => {
    let s = startTimer(freshTimer(), 0);
    const { state: ns, loggedFocusSec } = finishPhase(s, 3 * 60 * MIN, "completed"); // 3h later
    expect(loggedFocusSec).toBe(25 * 60);
    expect(ns.phase).toBe("short");
    void s;
  });

  it("a paused state is not expired", () => {
    const s = pauseTimer(startTimer(freshTimer(), 0), 5 * MIN);
    expect(isExpired(s, 999 * MIN)).toBe(false);
    expect(remainingMs(s, 999 * MIN)).toBe(20 * MIN);
  });
});

describe("switchPhase / resetPhase", () => {
  it("switching phases resets the countdown and elapsed accumulation", () => {
    let s = startTimer(freshTimer(), 0);
    s = pauseTimer(s, 10 * MIN);
    s = switchPhase(s, "long");
    expect(s.phase).toBe("long");
    expect(remainingMs(s, 0)).toBe(15 * MIN);
    expect(elapsedFocusMs(s, 0)).toBe(0);
  });

  it("resetPhase re-arms the current phase", () => {
    let s = startTimer(freshTimer(), 0);
    s = pauseTimer(s, 20 * MIN);
    s = resetPhase(s);
    expect(remainingMs(s, 0)).toBe(25 * MIN);
    expect(s.running).toBe(false);
  });
});

describe("clamp helpers", () => {
  it("clampMinutes bounds custom durations", () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes(47.6)).toBe(48);
    expect(clampMinutes(Number.NaN)).toBe(25);
  });

  it("clampState sanitizes restored state", () => {
    const s = clampState({
      ...freshTimer(),
      durations: { focus: 999, short: 0, long: -5 },
      roundsBefore: 99,
    } as TimerState);
    expect(s.durations.focus).toBe(180);
    expect(s.durations.short).toBe(1);
    expect(s.durations.long).toBe(1);
    expect(s.roundsBefore).toBe(6);
  });
});

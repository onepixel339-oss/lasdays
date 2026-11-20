// ═══════════════ Pomodoro timer core — pure, testable, drift-free ═══════════════
// The timer tracks *wall-clock* end times (endsAt), so it survives page reloads,
// SPA navigation, and background-tab throttling without drifting. Actual focus
// time is accumulated separately from phase durations, so pausing, skipping or
// custom durations all produce honest session logs.
// Pure module: every function takes `now` — no hidden clocks, fully unit-testable.

export type Phase = "focus" | "short" | "long";

export interface TimerDurations {
  focus: number; // minutes
  short: number;
  long: number;
}

export interface TimerState {
  v: 2;
  phase: Phase;
  running: boolean;
  /** wall-clock end of the current phase while running (epoch ms) */
  endsAt: number | null;
  /** remaining ms while paused (null if never started) */
  pausedLeftMs: number | null;
  round: number;
  roundsBefore: number;
  durations: TimerDurations;
  subject: string;
  /** accumulated actual running time of the current focus phase (ms) */
  focusElapsedMs: number;
  /** start of the current running stretch (epoch ms), null while paused */
  stretchStartedAt: number | null;
}

export const DEFAULT_DURATIONS: TimerDurations = { focus: 25, short: 5, long: 15 };
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

export function freshTimer(durations: TimerDurations = DEFAULT_DURATIONS, roundsBefore = 4): TimerState {
  return {
    v: 2,
    phase: "focus",
    running: false,
    endsAt: null,
    pausedLeftMs: null,
    round: 1,
    roundsBefore,
    durations,
    subject: "",
    focusElapsedMs: 0,
    stretchStartedAt: null,
  };
}

/** Clamp a user-supplied custom duration. */
export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DURATIONS.focus;
  return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(n)));
}

function phaseMs(s: TimerState, p: Phase): number {
  return (s.durations[p] ?? DEFAULT_DURATIONS[p]) * 60_000;
}

/** Actual focus time accumulated in the current focus phase (ms). */
export function elapsedFocusMs(s: TimerState, now: number): number {
  if (s.phase !== "focus") return 0;
  const stretch = s.running && s.stretchStartedAt != null ? Math.max(0, now - s.stretchStartedAt) : 0;
  return s.focusElapsedMs + stretch;
}

/** Remaining ms in the current phase. */
export function remainingMs(s: TimerState, now: number): number {
  if (s.running && s.endsAt != null) return Math.max(0, s.endsAt - now);
  if (s.pausedLeftMs != null) return Math.max(0, s.pausedLeftMs);
  return phaseMs(s, s.phase);
}

/** Total planned ms of the current phase. */
export function totalMs(s: TimerState): number {
  if (s.pausedLeftMs != null && !s.running) {
    // paused mid-phase: original planned length is what remains + consumed
    // consumed = phaseTotal - pausedLeft, but we only know durations — the
    // caller displays progress via remaining/total where total is the phase
    // duration; keep it consistent by returning the planned phase length.
    return phaseMs(s, s.phase);
  }
  return phaseMs(s, s.phase);
}

export function startTimer(s: TimerState, now: number): TimerState {
  if (s.running) return s;
  const left = s.pausedLeftMs ?? phaseMs(s, s.phase);
  return {
    ...s,
    running: true,
    endsAt: now + left,
    pausedLeftMs: null,
    stretchStartedAt: s.phase === "focus" ? now : null,
  };
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  if (!s.running) return s;
  const left = remainingMs(s, now);
  const patch: TimerState = {
    ...s,
    running: false,
    endsAt: null,
    pausedLeftMs: left,
    stretchStartedAt: null,
  };
  if (s.phase === "focus") {
    patch.focusElapsedMs = elapsedFocusMs(s, now);
  }
  return patch;
}

/**
 * Called when the current phase reaches zero (or the user skips).
 * Returns the new state plus what should be logged (focus phase → actual
 * elapsed seconds; break phase → null).
 */
export function finishPhase(
  s: TimerState,
  now: number,
  reason: "completed" | "skipped"
): { state: TimerState; loggedFocusSec: number | null } {
  const wasFocus = s.phase === "focus";
  // A naturally-completed phase can only count its planned duration — the tick
  // may fire late (background tab), and that overshoot wasn't studied time.
  const plannedMs = phaseMs(s, s.phase);
  const rawMs = elapsedFocusMs(s, now);
  const effectiveMs = reason === "completed" ? Math.min(rawMs, plannedMs) : rawMs;
  const loggedFocusSec = wasFocus ? Math.round(effectiveMs / 1000) : null;

  let round = s.round;
  let next: Phase;
  if (wasFocus) {
    next = round % Math.max(1, s.roundsBefore) === 0 ? "long" : "short";
    round = round + 1;
  } else {
    next = "focus";
  }

  return {
    state: {
      ...s,
      phase: next,
      running: false,
      endsAt: null,
      pausedLeftMs: null,
      round,
      focusElapsedMs: 0,
      stretchStartedAt: null,
    },
    loggedFocusSec,
  };
}

/** User pressed "skip". Focus phases log their real elapsed time. */
export function skipPhase(s: TimerState, now: number) {
  return finishPhase(s, now, "skipped");
}

/** Auto-complete on restore: a running phase whose end passed while away. */
export function isExpired(s: TimerState, now: number): boolean {
  return s.running && s.endsAt != null && s.endsAt <= now;
}

/** Switch phase manually (tabs) — resets the phase, keeps rounds/subject. */
export function switchPhase(s: TimerState, p: Phase): TimerState {
  return {
    ...s,
    phase: p,
    running: false,
    endsAt: null,
    pausedLeftMs: null,
    focusElapsedMs: 0,
    stretchStartedAt: null,
  };
}

/** Reset the current phase to its full duration (stop). */
export function resetPhase(s: TimerState): TimerState {
  return switchPhase(s, s.phase);
}

export function clampState(s: TimerState): TimerState {
  const ok: TimerDurations = {
    focus: clampMinutes(s.durations.focus),
    short: clampMinutes(s.durations.short ?? DEFAULT_DURATIONS.short),
    long: clampMinutes(s.durations.long ?? DEFAULT_DURATIONS.long),
  };
  return { ...s, durations: ok, roundsBefore: Math.max(2, Math.min(6, s.roundsBefore || 4)) };
}

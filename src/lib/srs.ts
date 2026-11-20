// ═══════════════ SRS — Simplified SM-2 (Anki-style) ═══════════════

export type Grade = "again" | "hard" | "good" | "easy";

export interface SchedState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
}

export interface SchedResult extends SchedState {
  dueAt: Date;
}

const MIN_EASE = 1.3;
const DAY = 86400000;

export function schedule(state: SchedState, grade: Grade, now = new Date()): SchedResult {
  let { ease, intervalDays, reps, lapses } = state;
  reps += 1;

  if (grade === "again") {
    lapses += 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
    intervalDays = 0; // 10 minutes
    return { ease, intervalDays, reps, lapses, dueAt: new Date(now.getTime() + 10 * 60000) };
  }

  if (reps === 1 || intervalDays < 1) {
    // learning steps
    if (grade === "hard") intervalDays = 0.5;
    else if (grade === "good") intervalDays = 1;
    else intervalDays = 3;
    if (grade === "easy") ease = Math.min(3.2, ease + 0.15);
    else if (grade === "hard") ease = Math.max(MIN_EASE, ease - 0.15);
  } else {
    if (grade === "hard") {
      ease = Math.max(MIN_EASE, ease - 0.15);
      intervalDays = Math.max(intervalDays + 0.5, intervalDays * 1.2);
    } else if (grade === "good") {
      intervalDays = intervalDays * ease;
    } else {
      ease = Math.min(3.2, ease + 0.15);
      intervalDays = intervalDays * ease * 1.3;
    }
    intervalDays = Math.min(intervalDays, 365);
  }

  const ms = intervalDays < 1 ? Math.round(intervalDays * DAY) : Math.round(intervalDays * DAY);
  return { ease, intervalDays, reps, lapses, dueAt: new Date(now.getTime() + ms) };
}

/** Interval preview label for the answer buttons (localized outside). */
export function previewInterval(state: SchedState, grade: Grade): string {
  const r = schedule(state, grade);
  const d = r.intervalDays;
  if (d === 0) return "10m";
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export function readiness(cards: { intervalDays: number; reps: number }[]): number {
  // 0–100% mastery indicator: mature cards weigh full, young cards weigh half
  if (!cards.length) return 0;
  let score = 0;
  for (const c of cards) {
    const mature = c.reps >= 3 && c.intervalDays >= 7;
    score += mature ? 1 : 0.5;
  }
  return Math.round((score / cards.length) * 100);
}

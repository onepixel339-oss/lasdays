// ═══════════════ Cairo calendar helpers — client & server safe (no db import) ═══════════════
// The whole app treats "a day" as an Africa/Cairo calendar day (YYYY-MM-DD strings).
// These helpers are calendar-exact: no UTC-offset or DST traps.

const CAIRO = "Africa/Cairo";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: CAIRO,
  hour: "2-digit",
  hour12: false,
});

/** Today's Cairo date as "2026-09-20". */
export function todayCairo(now: Date = new Date()): string {
  return DAY_FMT.format(now);
}

/** Cairo date N days from now — handy for form defaults. */
export function todayCairoAfter(days: number): string {
  return todayCairo(new Date(Date.now() + days * 86400000));
}

/** Current hour in Cairo (0–23). */
export function cairoHour(now: Date = new Date()): number {
  return Number(HOUR_FMT.format(now));
}

/** Calendar-exact day shift: "2026-09-20" - 1 → "2026-09-19". */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta)).toISOString().slice(0, 10);
}

/** Cairo calendar day of an arbitrary Date: "2026-09-20". */
export function cairoDayOf(d: Date): string {
  return DAY_FMT.format(d);
}

/**
 * The absolute Date at which the Cairo day `day` began (second-precision —
 * exact even across Cairo's DST transitions, via bisection on the formatter).
 * Used as the "since" bound for today's stats — immune to server timezone.
 */
export function startOfCairoDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const hi = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + 6 * 3600_000; // 08:00/09:00 Cairo of `day`
  const lo = hi - 30 * 3600_000; // 20:00/21:00 Cairo of the previous day
  let a = lo;
  let b = hi;
  while (b - a > 1000) {
    const mid = Math.floor((a + b) / 2);
    if (cairoDayOf(new Date(mid)) === day) b = mid;
    else a = mid;
  }
  return new Date(b);
}

/** Days between two Cairo day strings (target - from). */
export function daysBetween(from: string, target: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = target.split("-").map(Number);
  const a = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86400000);
}

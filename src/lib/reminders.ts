// ═══════════════ Local reminders — no server, no push, no cron ═══════════════
// Replaces the server's Web Push scheduler for the local-first app: reminders
// computed from the user's own data and shown inside the app when it opens.

import type { Exam, Sprint, Task } from "./datastore/types";
import { todayCairo } from "./day";

export interface ReminderItem {
  key:
    | "dueCards" | "dueOne"
    | "overdue" | "overdueOne"
    | "examToday" | "examSoon" | "examSoonOne"
    | "sprintBehind";
  vars?: Record<string, string | number>;
  href: string;
  tone: "primary" | "warning" | "danger";
}

export interface RemindersInput {
  dueCount: number;
  exams: Exam[];
  tasks: Task[];
  sprint: Sprint | null;
  today?: string; // YYYY-MM-DD (Cairo calendar); defaults to now
}

/** days from a → b (both YYYY-MM-DD), positive = b is later */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Pure reminder computation. Priority order:
 * exam today > overdue tasks > due cards > exams soon > sprint behind.
 * On-track sprints and empty states produce no reminders.
 */
export function computeReminders(input: RemindersInput): ReminderItem[] {
  const today = input.today ?? todayCairo();
  const out: ReminderItem[] = [];

  // ── exams: today + the next 3 days ──
  for (const ex of input.exams) {
    const d = dayDiff(today, ex.date);
    if (d === 0) out.push({ key: "examToday", vars: { t: ex.title }, href: "/home", tone: "danger" });
    else if (d === 1) out.push({ key: "examSoonOne", vars: { t: ex.title }, href: "/home", tone: "warning" });
    else if (d >= 2 && d <= 3) out.push({ key: "examSoon", vars: { t: ex.title, n: d }, href: "/home", tone: "warning" });
  }

  // ── overdue tasks ──
  const overdue = input.tasks.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;
  if (overdue === 1) out.push({ key: "overdueOne", href: "/tasks", tone: "warning" });
  else if (overdue > 1) out.push({ key: "overdue", vars: { n: overdue }, href: "/tasks", tone: "warning" });

  // ── flashcards due ──
  if (input.dueCount === 1) out.push({ key: "dueOne", href: "/srs", tone: "primary" });
  else if (input.dueCount > 1) out.push({ key: "dueCards", vars: { n: input.dueCount }, href: "/srs", tone: "primary" });

  // ── active sprint behind its schedule ──
  const s = input.sprint;
  if (s && s.active) {
    const total = Math.max(1, s.totalPages);
    // inclusive day counting: Nov 16→25 is 10 study days, today is day 6
    const span = Math.max(1, dayDiff(s.startDate, s.endDate) + 1);
    const elapsed = Math.min(dayDiff(s.startDate, today) + 1, span);
    const expected = (total * elapsed) / span; // pages expected by end of today
    const pagesForToday = Math.ceil(expected - s.donePages);
    if (pagesForToday > 0) {
      out.push({ key: "sprintBehind", vars: { t: s.name, n: pagesForToday }, href: "/sprints", tone: "warning" });
    }
  }

  const rank = { examToday: 0, overdue: 1, overdueOne: 1, dueCards: 2, dueOne: 2, examSoon: 3, examSoonOne: 3, sprintBehind: 4 } as const;
  return out.sort((a, b) => rank[a.key] - rank[b.key]).slice(0, 6);
}

/** Fetch everything the reminders need through the store contract. */
export async function collectReminders(store: {
  listDecks(): Promise<{ dueCount: number }[]>;
  listExams(): Promise<Exam[]>;
  listTasks(): Promise<Task[]>;
  listSprints(): Promise<Sprint[]>;
}): Promise<ReminderItem[]> {
  const [decks, exams, tasks, sprints] = await Promise.all([
    store.listDecks().catch(() => [] as { dueCount: number }[]),
    store.listExams().catch(() => [] as Exam[]),
    store.listTasks().catch(() => [] as Task[]),
    store.listSprints().catch(() => [] as Sprint[]),
  ]);
  const dueCount = decks.reduce((n, d) => n + (d.dueCount ?? 0), 0);
  return computeReminders({
    dueCount,
    exams,
    tasks,
    sprint: sprints.find((s) => s.active) ?? null,
  });
}

/** Once-per-day display gate (dismissed today → stays quiet today). */
export function remindersGateKey(today = todayCairo()): string {
  return `ld2_reminders_${today}`;
}

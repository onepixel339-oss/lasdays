"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers";
import { QUOTES } from "@/i18n";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { todayCairo, daysBetween } from "@/lib/day";
import {
  Timer, Brain, Quote, CalendarDays, Plus, Trash2, Pencil, Play, Target,
  CircleCheckBig, BookOpen, ArrowLeft, ArrowRight, Check, CalendarClock,
} from "lucide-react";

// ═══════════════ Home — لوحة اليوم · دفتر آخر النهار ═══════════════
// One question first: "what should I study next?" — the day/date, a short
// status, the next selected task and the primary "Start session" action sit
// above everything. Today's plan (scannable, completable) follows, then the
// review-due strip (purple = review only). Exams, the active sprint and the
// daily quote live in the side column / below the fold.

interface TaskRow { id: string; title: string; done: boolean; dueDate: string | null; subject: string | null; createdAt?: string }
interface SprintRow { id: string; name: string; totalPages: number; donePages: number; active: boolean; startDate: string; endDate: string }
interface ExamRow { id: string; title: string; subject: string | null; date: string }

/** Sort open tasks: overdue → dated (soonest first) → undated (newest first). */
function pickNextTask(tasks: TaskRow[], today: string): TaskRow | null {
  const open = tasks.filter((x) => !x.done);
  if (open.length === 0) return null;
  const rank = (t: TaskRow) => {
    if (!t.dueDate) return 2;
    if (t.dueDate < today) return 0;
    return 1;
  };
  return [...open].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return 0;
  })[0] ?? null;
}

export default function HomePage() {
  const { me, t, lang, dir } = useApp();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sprint, setSprint] = useState<SprintRow | null>(null);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [dueCards, setDueCards] = useState<number>(0);
  const [focusMin, setFocusMin] = useState(0);
  const [examOpen, setExamOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamRow | null>(null);
  const [examTitle, setExamTitle] = useState("");
  const [examSubject, setExamSubject] = useState("");
  const [examDate, setExamDate] = useState("");
  const [quoteIdx] = useState(() => Math.floor(Date.now() / 86400000) % QUOTES.length);

  const load = useCallback(async () => {
    const store = getStore();
    const [tr, sr, dr, ss, er] = await Promise.all([
      store.listTasks().catch(() => null),
      store.listSprints().catch(() => null),
      store.listDecks().catch(() => null),
      store.getTodaySessions().catch(() => null),
      store.listExams().catch(() => null),
    ]);
    setTasks(tr ?? []);
    setSprint((sr ?? []).find((s) => s.active) ?? null);
    setDueCards((dr ?? []).reduce((a, d) => a + d.dueCount, 0));
    setFocusMin(Math.round((ss?.todaySec ?? 0) / 60));
    setExams(er ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // greeting by Cairo hour
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }).format(new Date())
  );
  const greetKey = hour >= 5 && hour < 12 ? "home.morning" : hour < 17 ? "home.afternoon" : hour < 21 ? "home.evening" : "home.night";
  const dateLine = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());

  function openNewExam() {
    setEditingExam(null);
    setExamTitle("");
    setExamSubject("");
    setExamDate("");
    setExamOpen(true);
  }

  function openEditExam(ex: ExamRow) {
    setEditingExam(ex);
    setExamTitle(ex.title);
    setExamSubject(ex.subject ?? "");
    setExamDate(ex.date);
    setExamOpen(true);
  }

  async function saveExam() {
    if (!examTitle.trim() || !examDate) return;
    const store = getStore();
    const input = { title: examTitle.trim(), subject: examSubject.trim() || null, date: examDate };
    const ok = editingExam
      ? await store.updateExam(editingExam.id, input).then(() => true).catch(() => false)
      : await store.createExam(input).then(() => true).catch(() => false);
    if (ok) {
      setExamOpen(false);
      setEditingExam(null);
      load();
    }
  }

  async function deleteExam(id: string) {
    const ok = await getStore().deleteExam(id).then(() => true).catch(() => false);
    if (ok) setExams((xs) => xs.filter((x) => x.id !== id));
  }

  /** complete/uncomplete from the plan — same store call as the tasks page */
  async function toggleTask(task: TaskRow) {
    setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)));
    getStore().updateTask(task.id, { done: !task.done }).catch(() => null);
  }

  if (!me) return null;
  const today = todayCairo();
  const nextTask = pickNextTask(tasks, today);
  const plan = tasks.filter((x) => !x.done).slice(0, 3);
  const openTasks = tasks.filter((x) => !x.done).length;
  const quote = QUOTES[quoteIdx] ?? QUOTES[0]!;
  const Go = dir === "rtl" ? ArrowLeft : ArrowRight;

  /** session subject = task subject, falling back to the task title */
  const sessionSubject = (task: TaskRow) => encodeURIComponent(task.subject ?? task.title);

  // sprint progress (same inclusive math as reminders)
  const sprintPct = sprint ? Math.min(100, (sprint.donePages / sprint.totalPages) * 100) : 0;
  const sprintTarget = sprint
    ? Math.ceil(
        (sprint.totalPages / Math.max(1, daysBetween(sprint.startDate, sprint.endDate) + 1))
        * Math.min(Math.max(daysBetween(sprint.startDate, todayCairo()) + 1, 0), Math.max(1, daysBetween(sprint.startDate, sprint.endDate) + 1))
        - sprint.donePages
      )
    : 0;

  return (
    <div className="space-y-6" dir={dir}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ══ main column — the study decision ══ */}
        <div className="min-w-0 space-y-6">
          {/* ── 1) today + next step ── */}
          <section className="card-soft overflow-hidden">
            <div className="border-b border-border px-5 pb-4 pt-5">
              <p className="text-xs font-semibold text-muted-foreground">{dateLine}</p>
              <h1 className="mt-1 font-display text-2xl font-bold leading-snug md:text-3xl">
                {t(greetKey)}،{" "}
                <span className="text-primary">
                  {me.isGuest && me.username.startsWith("guest_") ? t("auth.guestName") : me.username}
                </span>
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Timer className="size-4 shrink-0" />
                  <span className="num-tabular">{focusMin}</span>
                  <span>{t("home.focusToday")}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CircleCheckBig className="size-4 shrink-0" />
                  <span className="num-tabular">{openTasks}</span>
                  <span>{t("home.tasksLeft")}</span>
                </span>
              </p>
            </div>

            <div className="px-5 py-5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-primary">
                <Target className="size-4" /> {t("home.nextStep")}
              </p>
              {nextTask ? (
                <>
                  <p className="mt-2 font-display text-xl font-bold leading-snug md:text-2xl">{nextTask.title}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {nextTask.subject && (
                      <span className="flex items-center gap-1">
                        <BookOpen className="size-3.5" /> {nextTask.subject}
                      </span>
                    )}
                    {nextTask.dueDate && (
                      <span className={`flex items-center gap-1 num-tabular ${nextTask.dueDate < today ? "font-semibold text-destructive" : ""}`}>
                        <CalendarClock className="size-3.5" />
                        {nextTask.dueDate === today ? t("common.today") : nextTask.dueDate}
                      </span>
                    )}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/focus?subject=${sessionSubject(nextTask)}`}
                      className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-base font-bold text-primary-foreground tap transition-transform active:scale-[0.98]"
                    >
                      <Play className="size-4" /> {t("home.startTask")}
                    </Link>
                    <Link
                      href="/tasks"
                      className="inline-flex h-12 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground/80 tap transition-colors hover:bg-accent"
                    >
                      {t("nav.tasks")}
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("home.noTaskHero")}</p>
                  <div className="mt-4">
                    <Link
                      href="/focus"
                      className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-base font-bold text-primary-foreground tap transition-transform active:scale-[0.98]"
                    >
                      <Play className="size-4" /> {t("home.startGeneral")}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── 2) review-due strip — purple, review only ── */}
          {dueCards > 0 && (
            <Link
              href="/srs"
              className="row-in flex min-h-14 items-center gap-3 rounded-lg border border-review/30 bg-review/10 px-4 py-3 transition-colors hover:bg-review/15 tap"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-review text-review-foreground">
                <Brain className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                {t("home.reviewStrip", { n: dueCards })}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-review px-3 py-2 text-xs font-bold text-review-foreground">
                {t("srs.startReview")} <Go className="size-3.5" />
              </span>
            </Link>
          )}

          {/* ── 3) today's plan — scannable, completable ── */}
          <section className="card-soft">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-base font-bold">{t("home.todaysPlan")}</h2>
              <Link href="/tasks" className="flex min-h-11 items-center gap-1 text-xs font-bold text-primary tap">
                {t("home.viewAll")} <Go className="size-3.5" />
              </Link>
            </div>
            {plan.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-sm font-semibold text-muted-foreground">{t("home.noTasks")}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground/90">{t("home.planEmptyHint")}</p>
                <Link
                  href="/tasks"
                  className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-xs font-bold text-foreground tap hover:bg-accent"
                >
                  <Plus className="size-3.5" /> {t("home.addTask")}
                </Link>
              </div>
            ) : (
              <ul>
                {plan.map((task, i) => {
                  const overdue = !task.done && task.dueDate != null && task.dueDate < today;
                  return (
                    <li
                      key={task.id}
                      className={`flex items-center gap-3 px-5 py-3 ${i > 0 ? "border-t border-border/70" : ""}`}
                    >
                      <button
                        onClick={() => toggleTask(task)}
                        className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-input transition-colors hover:border-primary tap"
                        aria-label={t("tasks.completed")}
                      >
                        <Check className="size-4 opacity-0 transition-opacity" aria-hidden />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium leading-relaxed">{task.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                          {task.subject && (
                            <span className="flex items-center gap-1">
                              <BookOpen className="size-3" /> {task.subject}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className={`flex items-center gap-1 num-tabular ${overdue ? "font-semibold text-destructive" : ""}`}>
                              <CalendarDays className="size-3" />
                              {task.dueDate === today ? t("common.today") : task.dueDate}
                            </span>
                          )}
                        </p>
                      </div>
                      <Link
                        href={`/focus?subject=${sessionSubject(task)}`}
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary tap"
                        aria-label={`${t("home.focusOnTask")}: ${task.title}`}
                      >
                        <Play className="size-4" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ══ side column — context, not the decision ══ */}
        <aside className="min-w-0 space-y-6">
          {/* ── exams ── */}
          <section className="card-soft">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-base font-bold">{t("home.exams")}</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={openNewExam}
                className="h-9 gap-1 rounded-lg px-2.5 text-xs font-bold text-primary tap"
              >
                <Plus className="size-3.5" /> {t("home.addExam")}
              </Button>
            </div>
            {exams.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">{t("home.noExams")}</p>
            ) : (
              <div>
                {exams.slice(0, 3).map((ex, i) => {
                  const d = daysBetween(todayCairo(), ex.date);
                  const label = d === 0 ? t("home.examToday") : d === 1 ? t("home.examOne") : t("home.examDays", { n: d });
                  const urgent = d <= 1;
                  return (
                    <div
                      key={ex.id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-border/70" : ""}`}
                    >
                      <span
                        className={`num-tabular grid size-10 shrink-0 place-items-center rounded-lg border text-sm font-bold ${
                          urgent ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-secondary text-foreground/80"
                        }`}
                      >
                        {Math.min(d, 99)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{ex.title}</p>
                        <p className="text-xs text-muted-foreground num-tabular">
                          {label}{ex.subject ? ` · ${ex.subject}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => openEditExam(ex)}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent tap"
                        aria-label={t("common.edit")}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => deleteExam(ex.id)}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive tap"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── active sprint ── */}
          {sprint && (
            <section className="card-soft px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold">{t("home.sprintActive")}</h2>
                {sprintTarget > 0 ? (
                  <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-bold text-warning num-tabular">
                    {t("home.sprintBehindShort")}: {sprintTarget}
                  </span>
                ) : (
                  <span className="rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success">
                    {t("home.sprintOnTrack")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-semibold">{sprint.name}</p>
              <div className="mt-2.5 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${sprintPct}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground num-tabular">
                  {sprint.donePages}/{sprint.totalPages} {t("home.pages")}
                </span>
              </div>
              <Link href="/sprints" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary tap">
                {t("sprint.logPages")} <Go className="size-3.5" />
              </Link>
            </section>
          )}

          {/* ── daily wisdom — the journal line of the day ── */}
          <section className="journal-rule rounded-lg border border-dashed border-border bg-card/60 px-5 py-4 ps-6 text-center">
            <p className="mx-auto flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Quote className="size-3" />
              {t("home.dailyVerse")}
            </p>
            <p className="mt-2 font-display text-lg leading-relaxed">{lang === "ar" ? quote.ar : quote.en}</p>
          </section>
        </aside>
      </div>

      {/* ── add/edit exam dialog ── */}
      <Dialog open={examOpen} onOpenChange={(v) => { setExamOpen(v); if (!v) setEditingExam(null); }}>
        <DialogContent dir={dir} className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">{editingExam ? t("common.edit") : t("home.addExam")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={examTitle}
              onChange={(e) => setExamTitle(e.target.value)}
              placeholder={t("home.examTitle")}
              className="bg-background"
              aria-label={t("home.examTitle")}
            />
            <Input
              value={examSubject}
              onChange={(e) => setExamSubject(e.target.value)}
              placeholder={t("home.examSubject")}
              className="bg-background"
              aria-label={t("home.examSubject")}
            />
            <Input
              type="date"
              min={todayCairo()}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              aria-label={t("home.examDate")}
              className="bg-background"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setExamOpen(false)} className="px-5 font-bold">
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveExam}
              disabled={!examTitle.trim() || !examDate}
              className="px-5 font-bold"
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

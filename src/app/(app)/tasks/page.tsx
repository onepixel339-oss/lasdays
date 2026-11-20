"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayCairo } from "@/lib/day";
import { Plus, Eraser, Trash2, BookOpen, CalendarDays, Check, Pencil, X, SlidersHorizontal, Play } from "lucide-react";

// ═══════════════ Tasks — قائمة اليوم · دفتر آخر النهار ═══════════════
// One readable list, not a wall of identical cards. Quick-add on top, quiet
// filters, rows separated by hairlines. Each open task can start a focus
// session directly (Play → /focus?subject=…). Priority shows only when it
// differs from the default — secondary details stay out of the way.

interface TaskRow {
  id: string;
  title: string;
  subject: string | null;
  priority: string;
  done: boolean;
  dueDate: string | null;
}

type Filter = "today" | "overdue" | "upcoming" | "completed";
const FILTERS: Filter[] = ["today", "overdue", "upcoming", "completed"];

export default function TasksPage() {
  const { t, dir } = useApp();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [filter, setFilter] = useState<Filter>("today");
  const [showExtra, setShowExtra] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", subject: "", priority: "normal", dueDate: "" });

  const load = useCallback(async () => {
    const tasks = await getStore().listTasks().catch(() => []);
    setTasks(tasks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Cairo-calendar today (not device-local, not UTC) — consistent with all day-boundary logic
  const today = todayCairo();

  const filtered = tasks.filter((x) => {
    if (filter === "completed") return x.done;
    if (x.done) return false;
    // tasks without a due date are always in "today" and "upcoming"
    if (!x.dueDate) return filter === "today" || filter === "upcoming";
    if (x.dueDate < today) return filter === "overdue" || filter === "today";
    if (x.dueDate === today) return filter === "today";
    return filter === "upcoming";
  });
  const counts = {
    today: tasks.filter((x) => !x.done && (!x.dueDate || x.dueDate <= today)).length,
    upcoming: tasks.filter((x) => !x.done && x.dueDate && x.dueDate > today).length,
    overdue: tasks.filter((x) => !x.done && x.dueDate && x.dueDate < today).length,
    completed: tasks.filter((x) => x.done).length,
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await getStore().createTask({
        title: title.trim(),
        subject: subject.trim() || null,
        priority,
        dueDate: dueDate || null,
      });
    } catch {
      return; // validation failed — keep the form as-is
    }
    setTitle("");
    setSubject("");
    setPriority("normal");
    setDueDate("");
    setShowExtra(false);
    load();
  }

  async function toggle(task: TaskRow) {
    setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)));
    getStore().updateTask(task.id, { done: !task.done }).catch(() => null);
  }

  async function saveEdit(id: string) {
    if (!draft.title.trim()) return;
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...draft, subject: draft.subject || null } : x)));
    getStore()
      .updateTask(id, {
        title: draft.title.trim(),
        subject: draft.subject.trim() || null,
        priority: draft.priority as "low" | "normal" | "high",
        dueDate: draft.dueDate || null,
      })
      .catch(() => null);
    setEditingId(null);
  }

  async function del(id: string) {
    if (!confirm(t("tasks.deleteConfirm"))) return;
    setTasks((ts) => ts.filter((x) => x.id !== id));
    getStore().deleteTask(id).catch(() => null);
  }

  async function clearDone() {
    const done = tasks.filter((x) => x.done);
    setTasks((ts) => ts.filter((x) => !x.done));
    await Promise.all(done.map((x) => getStore().deleteTask(x.id).catch(() => null)));
  }

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">{t("tasks.title")}</h1>
        {counts.completed > 0 && (
          <Button variant="ghost" size="sm" onClick={clearDone} className="gap-1.5 text-muted-foreground">
            <Eraser className="size-4" /> {t("tasks.clearDone")}
          </Button>
        )}
      </div>

      {/* ── quick add ── */}
      <form onSubmit={add} className="card-soft p-3">
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("tasks.addPlaceholder")}
            className="h-12 flex-1 bg-background text-base"
            aria-label={t("tasks.addPlaceholder")}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowExtra((s) => !s)}
            className="h-12 shrink-0 gap-1.5 px-3 text-xs font-bold"
            aria-pressed={showExtra}
            aria-label={showExtra ? t("common.close") : t("tasks.details")}
          >
            <SlidersHorizontal className="size-4" /> {t("tasks.details")}
          </Button>
          <Button type="submit" className="h-12 shrink-0 gap-1.5 px-4 font-bold" disabled={!title.trim()}>
            <Plus className="size-5" /> {t("common.add")}
          </Button>
        </div>
        {showExtra && (
          <div className="row-in mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={`${t("tasks.subject")} (${t("common.optional")})`}
              className="h-11 bg-background text-sm"
              aria-label={t("tasks.subject")}
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
              aria-label={t("tasks.priority")}
            >
              <option value="low">{t("tasks.low")}</option>
              <option value="normal">{t("tasks.normal")}</option>
              <option value="high">{t("tasks.high")}</option>
            </select>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="col-span-2 h-11 bg-background text-sm sm:col-span-1"
              aria-label={t("tasks.dueDate")}
            />
          </div>
        )}
      </form>

      {/* ── filters ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors tap ${
              filter === f
                ? "bg-foreground font-bold text-background shadow-soft"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tasks.${f}`)}
            {counts[f] > 0 && <span className="ms-1.5 num-tabular opacity-70">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {/* ── the list — one surface, hairline rows ── */}
      <div className="card-soft overflow-hidden">
        {!loaded && <p className="px-5 py-6 text-sm text-muted-foreground">{t("common.loading")}</p>}
        {loaded && filtered.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            {filter === "completed" ? t("tasks.emptyDone") : t("tasks.noTasks")}
          </p>
        )}
        {filtered.map((task, i) => {
          const overdue = !task.done && task.dueDate && task.dueDate < today;
          return (
            <div
              key={task.id}
              className={`px-4 py-3 transition-opacity sm:px-5 ${task.done ? "opacity-55" : ""} ${i > 0 ? "border-t border-border/70" : ""}`}
            >
              {editingId === task.id ? (
                <div className="space-y-2">
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="h-11 bg-background"
                    aria-label={t("tasks.title")}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Input
                      value={draft.subject}
                      onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      placeholder={t("tasks.subject")}
                      className="h-11 bg-background text-sm"
                      aria-label={t("tasks.subject")}
                    />
                    <select
                      value={draft.priority}
                      onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                      className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
                      aria-label={t("tasks.priority")}
                    >
                      <option value="low">{t("tasks.low")}</option>
                      <option value="normal">{t("tasks.normal")}</option>
                      <option value="high">{t("tasks.high")}</option>
                    </select>
                    <Input
                      type="date"
                      value={draft.dueDate}
                      onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                      className="h-11 bg-background text-sm"
                      aria-label={t("tasks.dueDate")}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="size-4" /> {t("common.cancel")}
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(task.id)} className="px-4 font-bold">
                      <Check className="size-4" /> {t("common.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggle(task)}
                    className={`grid size-8 shrink-0 place-items-center rounded-full border-2 transition-colors tap ${task.done ? "check-pop border-success bg-success text-success-foreground" : "border-input hover:border-primary"}`}
                    aria-label={task.done ? t("tasks.completed") : t("common.confirm")}
                  >
                    {task.done && <Check className="size-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[15px] font-medium leading-relaxed ${task.done ? "line-through" : ""}`}>{task.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {task.subject && (
                        <span className="flex items-center gap-1">
                          <BookOpen className="size-3" /> {task.subject}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 num-tabular ${overdue ? "font-bold text-destructive" : ""}`}>
                          <CalendarDays className="size-3" />
                          {task.dueDate === today ? t("common.today") : task.dueDate}
                        </span>
                      )}
                      {/* priority is secondary — only surface it when it deviates */}
                      {task.priority === "high" && (
                        <span className="rounded-full bg-destructive/12 px-1.5 py-0.5 font-semibold text-destructive">
                          {t("tasks.high")}
                        </span>
                      )}
                      {task.priority === "low" && (
                        <span className="rounded-full bg-success/12 px-1.5 py-0.5 font-semibold text-success">
                          {t("tasks.low")}
                        </span>
                      )}
                    </div>
                  </div>
                  {!task.done && (
                    <Link
                      href={`/focus?subject=${encodeURIComponent(task.subject ?? task.title)}`}
                      className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary tap"
                      aria-label={`${t("tasks.startFocus")}: ${task.title}`}
                    >
                      <Play className="size-4" />
                    </Link>
                  )}
                  {!task.done && (
                    <button
                      onClick={() => {
                        setEditingId(task.id);
                        setDraft({ title: task.title, subject: task.subject ?? "", priority: task.priority, dueDate: task.dueDate ?? "" });
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent tap"
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                  <button
                    onClick={() => del(task.id)}
                    className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive tap"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

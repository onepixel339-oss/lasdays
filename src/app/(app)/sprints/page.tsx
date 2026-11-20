"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayCairo, todayCairoAfter } from "@/lib/day";
import { Trash2, Clock3, Zap, CalendarDays, Pencil, Check, X } from "lucide-react";

// ═══════════════ Sprints: split pages across days, log daily progress ═══════════════

interface SprintRow {
  id: string;
  name: string;
  subject: string | null;
  totalPages: number;
  donePages: number;
  startDate: string;
  endDate: string;
  active: boolean;
}

export default function SprintsPage() {
  const { t, dir } = useApp();
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [totalPages, setTotalPages] = useState("");
  const startDate = todayCairo();
  const [endDate, setEndDate] = useState(() => todayCairoAfter(30));
  const [err, setErr] = useState<string | null>(null);
  const [logInput, setLogInput] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", totalPages: "" });

  const load = useCallback(async () => {
    const rows = await getStore().listSprints().catch(() => []);
    setSprints(rows);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const pages = Number(totalPages);
    if (!name.trim() || !pages) return;
    if (endDate <= startDate) { setErr(t("sprint.invalidDates")); return; }
    try {
      await getStore().createSprint({
        name: name.trim(),
        subject: subject.trim() || null,
        totalPages: pages,
        startDate,
        endDate,
      });
    } catch {
      return;
    }
    setName(""); setSubject(""); setTotalPages("");
    load();
  }

  async function patch(id: string, body: object) {
    await getStore().updateSprint(id, body).catch(() => null);
    load();
  }

  async function del(id: string) {
    setSprints((ss) => ss.filter((s) => s.id !== id));
    getStore().deleteSprint(id).catch(() => null);
  }

  const today = todayCairo();

  /** daily target remaining today = total/(days) adjusted by progress */
  function targetPerDay(s: SprintRow) {
    const start = new Date(s.startDate + "T00:00:00");
    const end = new Date(s.endDate + "T00:00:00");
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const remaining = s.totalPages - s.donePages;
    const daysLeft = Math.max(1, Math.ceil((end.getTime() - new Date(today + "T00:00:00").getTime()) / 86400000));
    return { perDay: Math.ceil(s.totalPages / days), pagesLeft: remaining, daysLeft };
  }

  function scheduleState(s: SprintRow) {
    const { daysLeft } = targetPerDay(s);
    const remaining = s.totalPages - s.donePages;
    const ideal = Math.ceil((s.totalPages / Math.max(1, Math.round((new Date(s.endDate + "T00:00:00").getTime() - new Date(s.startDate + "T00:00:00").getTime()) / 86400000))) * (daysLeft));
    if (remaining === 0) return t("sprint.finished");
    if (remaining < ideal - Math.ceil(s.totalPages * 0.02)) return t("sprint.aheadOfSchedule");
    if (remaining > ideal + Math.ceil(s.totalPages * 0.02)) return t("sprint.behindSchedule");
    return t("sprint.onTrack");
  }

  return (
    <div className="space-y-5" dir={dir}>
      <div>
        <h1 className="font-display text-2xl font-bold">{t("sprint.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("sprint.subtitle")}</p>
      </div>

      {/* create */}
      <form onSubmit={add} className="card-soft space-y-3 p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("sprint.namePlaceholder")}
          className="h-11 bg-background"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={`${t("sprint.subject")} (${t("common.optional")})`}
            className="col-span-2 h-11 bg-background sm:col-span-4"
          />
          <Input
            value={totalPages}
            onChange={(e) => setTotalPages(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={t("sprint.totalPages")}
            className="h-11 bg-background"
          />
          <label className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm">
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-11 w-full bg-transparent outline-none"
            />
          </label>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="h-11 w-full rounded-lg font-bold shadow-soft">
          {t("sprint.create")}
        </Button>
      </form>

      {/* list */}
      {!loaded && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {loaded && sprints.length === 0 && (
        <p className="card-soft p-6 text-center text-sm text-muted-foreground">{t("sprint.noSprints")}</p>
      )}

      {sprints.map((s) => {
        const pct = Math.min(100, Math.round((s.donePages / s.totalPages) * 100));
        const { perDay, pagesLeft, daysLeft } = targetPerDay(s);
        return (
          <div key={s.id} className={`card-soft p-4 ${s.active ? "ring-2 ring-primary/40" : "opacity-80"}`}>
            {editingId === s.id ? (
              <div className="space-y-2">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-11 bg-background"
                  aria-label={t("sprint.name")}
                />
                <Input
                  value={draft.totalPages}
                  onChange={(e) => setDraft({ ...draft, totalPages: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  className="h-11 bg-background"
                  aria-label={t("sprint.totalPages")}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    <X className="size-4" /> {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!draft.name.trim()) return;
                      const body: Record<string, unknown> = { name: draft.name.trim() };
                      const tp = Number(draft.totalPages);
                      if (tp) body.totalPages = tp;
                      patch(s.id, body);
                      setEditingId(null);
                    }}
                    className="rounded-full px-4 font-bold"
                  >
                    <Check className="size-4" /> {t("common.save")}
                  </Button>
                </div>
              </div>
            ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold">
                  {s.active && <span className="me-1.5 inline-block size-2 rounded-full bg-success align-middle" />}
                  {s.name}
                </h3>
                {s.subject && <p className="text-xs text-muted-foreground">{s.subject}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                {!s.active && (
                  <Button size="sm" variant="secondary" onClick={() => patch(s.id, { active: true })} className="rounded-full">
                    {t("sprint.activate")}
                  </Button>
                )}
                <button
                  onClick={() => { setEditingId(s.id); setDraft({ name: s.name, totalPages: String(s.totalPages) }); }}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent tap"
                  aria-label={t("common.edit")}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => del(s.id)}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive tap"
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            )}

            {/* progress */}
            {editingId !== s.id && (
            <>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-bold text-primary num-tabular">{pct}%</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="num-tabular">{s.donePages}/{s.totalPages} · {perDay} {t("sprint.perDay")}</span>
              <span className="num-tabular">{t("sprint.pagesLeft")}: {pagesLeft}</span>
              <span className="flex items-center gap-1 num-tabular">
                <Clock3 className="size-3.5" /> {daysLeft} {t("sprint.daysLeft")}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-foreground/70">{scheduleState(s)}</p>
            </>
            )}

            {/* log today's pages */}
            {s.donePages < s.totalPages && (
              <div className="mt-3 flex gap-2">
                <Input
                  value={logInput[s.id] ?? ""}
                  onChange={(e) => setLogInput((m) => ({ ...m, [s.id]: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric"
                  placeholder={t("sprint.logPages")}
                  className="h-11 flex-1 bg-background text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const n = Number(logInput[s.id]);
                    if (!n) return;
                    patch(s.id, { addPages: n });
                    setLogInput((m) => ({ ...m, [s.id]: "" }));
                  }}
                  className="h-11 rounded-lg px-4 font-bold"
                >
                  + {t("home.page")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => patch(s.id, { addPages: perDay })}
                  className="h-11 gap-1 rounded-lg px-3 font-bold"
                >
                  <Zap className="size-4" /> {perDay}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

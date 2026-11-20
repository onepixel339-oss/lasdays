"use client";

import React, { useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DECK_COLORS, type DeckRow } from "./shared";
import { Plus, Trash2, Layers, Flame, Gem, BookOpen, Play, Pencil, Check, Brain } from "lucide-react";

// ═══════════════ DecksList — مراجعة أولًا · دفتر آخر النهار ═══════════════
// The review hub comes first: how many cards are due, and ONE clear action to
// start (purple = review identity). Deck management is secondary below.

export function DecksList({ decks, loaded, onOpen, onStartAll, onChanged }: {
  decks: DeckRow[]; loaded: boolean;
  onOpen: (id: string) => void;
  onStartAll: () => void;
  onChanged: () => void;
}) {
  const { t, dir } = useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [color, setColor] = useState(DECK_COLORS[0] ?? "#B85C38");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", subject: "", color: DECK_COLORS[0] ?? "#B85C38" });

  const totalDue = decks.reduce((a, d) => a + (d.dueCount ?? 0), 0);

  async function create() {
    if (!name.trim()) return;
    await getStore().createDeck({ name: name.trim(), subject: subject.trim() || null, color }).catch(() => null);
    setName(""); setSubject(""); setCreating(false);
    onChanged();
  }

  async function del(id: string) {
    if (!confirm(t("srs.deleteDeckConfirm"))) return;
    await getStore().deleteDeck(id).catch(() => null);
    onChanged();
  }

  function startEdit(d: DeckRow) {
    setEditingId(d.id);
    setDraft({ name: d.name, subject: d.subject ?? "", color: d.color });
  }

  async function saveEdit() {
    if (!editingId || !draft.name.trim()) return;
    await getStore()
      .updateDeck(editingId, { name: draft.name.trim(), subject: draft.subject.trim() || null, color: draft.color })
      .catch(() => null);
    setEditingId(null);
    onChanged();
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div>
        <h1 className="font-display text-2xl font-bold">{t("srs.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("srs.subtitle")}</p>
      </div>

      {/* ── review hub — the reason this page exists ── */}
      <section className="card-soft overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-review text-review-foreground">
            <Brain className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-3xl font-bold leading-none text-review num-tabular">{totalDue}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("srs.dueNow")}</p>
          </div>
          {totalDue > 0 && (
            <Button
              onClick={onStartAll}
              className="h-12 gap-2 rounded-lg bg-review px-6 text-base font-bold text-review-foreground hover:bg-review/90"
            >
              <Play className="size-4" /> {t("srs.startAll")}
            </Button>
          )}
        </div>
        {totalDue === 0 && loaded && (
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">{t("srs.allCaughtUp")}</p>
        )}
      </section>

      {/* ── deck management — secondary ── */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-muted-foreground">{t("srs.yourDecks")}</h2>
        {!creating && (
          <Button onClick={() => setCreating(true)} size="sm" variant="secondary" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-bold">
            <Plus className="size-3.5" /> {t("srs.newDeck")}
          </Button>
        )}
      </div>

      {creating ? (
        <div className="card-soft row-in space-y-3 p-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("srs.deckName")}
            className="bg-background" autoFocus aria-label={t("srs.deckName")} />
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`${t("srs.subject")} (${t("common.optional")})`}
            className="bg-background" aria-label={t("srs.subject")} />
          <div className="flex items-center gap-2">
            {DECK_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={`size-9 rounded-full transition-transform tap ${color === c ? "scale-110 ring-2 ring-offset-2 ring-offset-card" : ""}`}
                style={{ background: c, ...(color === c ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}
                aria-label={c} />
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={create} className="h-11 flex-1 rounded-lg font-bold" disabled={!name.trim()}>{t("common.add")}</Button>
            <Button variant="ghost" onClick={() => setCreating(false)} className="h-11 rounded-lg">{t("common.cancel")}</Button>
          </div>
        </div>
      ) : null}

      {!loaded && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {loaded && decks.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-sm text-muted-foreground">{t("srs.noDecks")}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {decks.map((d) => (
          <div key={d.id} className="card-soft relative overflow-hidden p-4">
            <div className="absolute inset-y-0 start-0 w-1.5" style={{ background: d.color }} />
            {editingId === d.id ? (
              <div className="space-y-2">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-11 bg-background" aria-label={t("srs.deckName")} />
                <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="h-11 bg-background" placeholder={`${t("srs.subject")} (${t("common.optional")})`}
                  aria-label={t("srs.subject")} />
                <div className="flex items-center gap-2">
                  {DECK_COLORS.map((c) => (
                    <button key={c} onClick={() => setDraft({ ...draft, color: c })}
                      className={`size-8 rounded-full transition-transform tap ${draft.color === c ? "scale-110 ring-2 ring-offset-2 ring-offset-card" : ""}`}
                      style={{ background: c }} aria-label={c} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} className="flex-1 rounded-lg font-bold" disabled={!draft.name.trim()}>
                    <Check className="size-4" /> {t("common.save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="rounded-lg">
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <button onClick={() => onOpen(d.id)} className="w-full text-start tap">
                  <h3 className="font-display text-lg font-bold">{d.name}</h3>
                  {d.subject && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BookOpen className="size-3" /> {d.subject}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 num-tabular">
                      <Layers className="size-3.5" /> {d.cardCount} {t("srs.cardCount")}
                    </span>
                    {(d.dueCount ?? 0) > 0 && (
                      <span className="flex items-center gap-1 font-bold text-review num-tabular">
                        <Flame className="size-3.5" /> {d.dueCount} {t("srs.dueNow")}
                      </span>
                    )}
                    <span className="flex items-center gap-1 num-tabular">
                      <Gem className="size-3.5" /> {d.matureCount}
                    </span>
                  </div>
                  {/* readiness bar */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${d.readiness}%`, background: d.color }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground num-tabular">{d.readiness}%</span>
                  </div>
                </button>
                <div className="absolute top-3 end-3 flex gap-0.5">
                  <button onClick={() => startEdit(d)}
                    className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent tap"
                    aria-label={t("common.edit")}><Pencil className="size-4" /></button>
                  <button onClick={() => del(d.id)}
                    className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive tap"
                    aria-label={t("common.delete")}><Trash2 className="size-4" /></button>
                </div>
                {(d.dueCount ?? 0) > 0 && (
                  <Button
                    onClick={() => onOpen(d.id)}
                    size="sm"
                    className="mt-3 h-10 w-full gap-1.5 rounded-lg font-bold"
                    style={{ background: d.color }}
                  >
                    <Play className="size-4" /> {t("srs.review")} ({d.dueCount})
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import React, { useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickImage, parseCsv, type DeckRow } from "./shared";
import {
  Pencil, X, Trash2, Play, ArrowRight, Image as ImageIcon, FileUp, Search,
} from "lucide-react";

// ═══════════════ DeckDetail: add/edit/delete cards + search + CSV import ═══════════════

export function DeckDetail({ deck, onBack, onReview, onChanged }: {
  deck: DeckRow;
  onBack: () => void; onReview: () => void; onChanged: () => void;
}) {
  const { t, dir } = useApp();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ front: "", back: "" });
  const [image, setImage] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);
  const cards = deck.cards ?? [];

  async function addCard() {
    if (!front.trim() || !back.trim()) return;
    await getStore().createCard({ deckId: deck.id, front: front.trim(), back: back.trim(), image }).catch(() => null);
    setFront(""); setBack(""); setImage(null);
    onChanged();
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    const data = await pickImage(file);
    if (data) setImage(data);
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (!rows.length) {
      setCsvMsg(t("srs.csvEmpty"));
      return;
    }
    let created = 0;
    try {
      created = await getStore().importCards(deck.id, rows);
      setCsvMsg(t("srs.importDone", { n: created }));
      onChanged();
    } catch {
      setCsvMsg(t("errors.server"));
    }
    setTimeout(() => setCsvMsg(null), 5000);
  }

  async function delCard(id: string) {
    await getStore().deleteCard(id).catch(() => null);
    onChanged();
  }

  async function saveEdit() {
    if (!editing) return;
    await getStore().updateCard(editing, draft).catch(() => null);
    setEditing(null);
    onChanged();
  }

  // search: front / back — client-side, cards are fully loaded
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? cards.filter((c) => c.front.toLowerCase().includes(needle) || c.back.toLowerCase().includes(needle))
    : cards;

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="grid size-11 place-items-center rounded-full border border-border bg-card tap" aria-label="back">
          <ArrowRight className="size-5 rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold">{deck.name}</h1>
          <p className="text-xs text-muted-foreground num-tabular">
            {deck.cardCount} {t("srs.cardCount")} · {deck.dueCount} {t("srs.dueNow")} · {deck.matureCount} {t("srs.mature")}
          </p>
        </div>
        {(deck.dueCount ?? 0) > 0 && (
          <Button onClick={onReview} className="gap-1.5 rounded-lg bg-review font-bold text-review-foreground hover:bg-review/90">
            <Play className="size-4" /> {t("srs.startReview")}
          </Button>
        )}
      </div>

      {/* add card */}
      <div className="card-soft space-y-2 p-4">
        <Input value={front} onChange={(e) => setFront(e.target.value)} placeholder={t("srs.frontPlaceholder")}
          className="h-11 bg-background" />
        <Input value={back} onChange={(e) => setBack(e.target.value)} placeholder={t("srs.backPlaceholder")}
          className="h-11 bg-background" />
        {/* media row: image + CSV — study-focused */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-accent/60 px-3 text-xs font-semibold text-muted-foreground tap">
            <ImageIcon className="size-4" /> {t("srs.image")}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void onPickImage(e.target.files?.[0])} />
          </label>
          <button
            onClick={() => csvRef.current?.click()}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-accent/60 px-3 text-xs font-semibold text-muted-foreground tap"
          >
            <FileUp className="size-4" /> {t("srs.importCsv")}
          </button>
          <input
            ref={csvRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ""; }}
          />
          {image && (
            <span className="flex items-center gap-1 rounded-xl bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary">
              <ImageIcon className="size-3.5" /> {t("srs.image")}
              <button onClick={() => setImage(null)} aria-label={t("common.delete")} className="tap"><X className="size-3.5" /></button>
            </span>
          )}
        </div>
        {/* data URLs — next/image cannot optimize these */}
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs cannot be optimized
          <img src={image} alt="" className="max-h-32 rounded-lg object-contain" />
        )}
        {csvMsg && <p className="text-xs font-semibold text-primary">{csvMsg}</p>}
        <Button onClick={addCard} className="h-11 w-full rounded-lg font-bold" disabled={!front.trim() || !back.trim()}>＋ {t("srs.addCard")}</Button>
      </div>

      {/* search */}
      {cards.length > 0 && (
        <div className="relative">
          <Search className="absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common.search")}
            className="h-11 rounded-lg bg-card ps-10"
            aria-label={t("common.search")}
          />
        </div>
      )}

      {/* cards */}
      {cards.length === 0 && <p className="text-center text-sm text-muted-foreground">{t("srs.noCards")}</p>}
      {cards.length > 0 && visible.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("common.noResults")}</p>
      )}
      <div className="space-y-2">
        {visible.map((c) => (
          <div key={c.id} className="card-soft p-3.5">
            {editing === c.id ? (
              <>
                <Input value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })}
                  className="h-11 bg-background" />
                <Input value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })}
                  className="mt-2 h-11 bg-background" />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                  <Button size="sm" onClick={saveEdit} className="rounded-lg px-4 font-bold">{t("common.save")}</Button>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.front}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{c.back}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground num-tabular">
                    <span>
                      {t("srs.progress")}: {c.intervalDays >= 1 ? `${c.intervalDays}d` : "10m"} · ×{c.reps}
                      {c.lapses > 0 && ` · ↺${c.lapses}`}
                    </span>
                    {c.image && <ImageIcon className="size-3" />}
                  </p>
                </div>
                <button onClick={() => { setEditing(c.id); setDraft({ front: c.front, back: c.back }); }}
                  className="grid size-7 place-items-center rounded-full hover:bg-accent tap" aria-label="edit"><Pencil className="size-4" /></button>
                <button onClick={() => delCard(c.id)}
                  className="grid size-7 place-items-center rounded-full hover:bg-destructive/10 hover:text-destructive tap" aria-label="delete"><Trash2 className="size-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

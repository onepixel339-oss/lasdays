"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { previewInterval } from "@/lib/srs";
import type { Grade } from "@/lib/srs";
import type { CardRow, DeckRow } from "./shared";
import { X, Eye, Brain, CircleCheckBig } from "lucide-react";

// ═══════════════ ReviewSession — بطاقة واحدة في المرة · دفتر آخر النهار ═══════════════
// One prompt, reveal, four touch-friendly ratings. Progress and accents are
// review-purple; completion settles quietly (no confetti, no fireworks).

export function ReviewSession({ deck, onExit }: {
  deck: DeckRow; onExit: () => void;
}) {
  const { t, dir } = useApp();
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBack, setShowBack] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [justDone, setJustDone] = useState(false);

  useEffect(() => {
    // deck.id === "" → review across every deck (the hub action)
    const req = deck.id ? getStore().getDueCards(deck.id) : getStore().getDueCards();
    req
      .then((cards) => setQueue(cards))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [deck.id]);

  const current = queue[0];

  const grades: { key: Grade; label: string; style: string }[] = useMemo(() => [
    { key: "again", label: t("srs.again"), style: "bg-destructive/12 text-destructive border-destructive/30" },
    { key: "hard", label: t("srs.hard"), style: "bg-warning/12 text-warning border-warning/30" },
    { key: "good", label: t("srs.good"), style: "bg-review/12 text-review border-review/30" },
    { key: "easy", label: t("srs.easy"), style: "bg-success/12 text-success border-success/30" },
  ], [t]);

  async function grade(g: Grade) {
    if (!current) return;
    // Compute the next queue from the *current* snapshot (never from stale
    // render state): the rest of the queue, plus the card again at the end
    // when graded "again". The session is over only when nothing is queued.
    const remaining = queue.slice(1);
    const requeued =
      g === "again"
        ? [...remaining, { ...current, dueAt: new Date().toISOString() }]
        : remaining;
    setQueue(requeued);
    setShowBack(false);
    setDoneCount((n) => n + 1);
    if (requeued.length === 0) setJustDone(true);

    try {
      await getStore().submitReview(current.id, g);
    } catch { /* offline — grade lost; next sync of dueAt will re-show the card */ }
  }

  if (loading) {
    return <div className="grid min-h-[50vh] place-items-center" dir={dir}><Brain className="size-8 animate-pulse text-muted-foreground" /></div>;
  }

  if (justDone || (!current && queue.length === 0)) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-center" dir={dir}>
        <div>
          <span className={`mx-auto grid size-20 place-items-center rounded-full ${doneCount > 0 ? "bg-review/15 text-review" : "bg-success/15 text-success"}`}>
            <CircleCheckBig className="size-9" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">{t("srs.doneForNow")}</h2>
          {doneCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground num-tabular">
              {doneCount} {t("srs.reviewedToday")}
            </p>
          )}
          <Button onClick={onExit} className="mt-6 rounded-lg px-8 font-bold">
            {t("common.close")}
          </Button>
        </div>
      </div>
    );
  }

  const total = doneCount + queue.length;
  return (
    <div className="space-y-5" dir={dir}>
      {/* header */}
      <div className="flex items-center gap-3">
        <button onClick={onExit} className="grid size-11 place-items-center rounded-full border border-border bg-card tap" aria-label={t("common.close")}>
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-bold">{deck.name}</h1>
          <p className="text-xs text-muted-foreground num-tabular">
            {doneCount}/{total} · {t("srs.progress")} {Math.round((doneCount / Math.max(1, total)) * 100)}%
          </p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-review transition-[width] duration-300 ease-out"
          style={{ width: `${(doneCount / Math.max(1, total)) * 100}%` }} />
      </div>

      {current && <CardFace card={current} color={deck.color} showBack={showBack} />}

      {/* actions */}
      {!showBack ? (
        <Button onClick={() => setShowBack(true)} className="h-13 w-full gap-2 rounded-lg py-3.5 text-base font-bold">
          <Eye className="size-5" /> {t("srs.showAnswer")}
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {grades.map((g) => {
            const iv = previewInterval(
              { ease: current!.ease, intervalDays: current!.intervalDays, reps: current!.reps, lapses: current!.lapses },
              g.key
            );
            return (
              <button key={g.key} onClick={() => grade(g.key)}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border py-2.5 font-bold transition-colors tap ${g.style}`}>
                <span className="text-sm">{g.label}</span>
                <span className="text-[11px] font-medium opacity-70 num-tabular">{iv}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** front + optional image + back (after reveal) */
function CardFace({ card, color, showBack }: {
  card: CardRow; color: string; showBack: boolean;
}) {
  return (
    <div className="card-soft relative min-h-[320px] p-6 [perspective:1000px]">
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-[inherit]" style={{ background: color }} />
      <div className="flex h-full min-h-[270px] flex-col items-center justify-center text-center">
        <p className="font-display text-2xl font-bold leading-relaxed">{card.front}</p>
        {card.image && (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs cannot be optimized
          <img src={card.image} alt="" className="mt-3 max-h-44 rounded-lg object-contain" />
        )}
        {showBack && (
          <>
            <div className="my-4 h-px w-24 bg-border" />
            <p className="swap-in text-lg leading-relaxed text-foreground/85">{card.back}</p>
          </>
        )}
      </div>
    </div>
  );
}

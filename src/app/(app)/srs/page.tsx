"use client";

import React, { useCallback, useEffect, useState } from "react";
import { DecksList } from "@/components/srs/DecksList";
import { DeckDetail } from "@/components/srs/DeckDetail";
import { ReviewSession } from "@/components/srs/ReviewSession";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import type { DeckRow } from "@/components/srs/shared";

// ═══════════════ SRS page: thin router between list / detail / review ═══════════════

export default function SrsPage() {
  const { t } = useApp();
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openDeck, setOpenDeck] = useState<DeckRow | null>(null);
  const [reviewing, setReviewing] = useState<DeckRow | null>(null);

  const load = useCallback(async () => {
    const rows = await getStore().listDecks().catch(() => []);
    setDecks(rows);
    setLoaded(true);
    return rows;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** Deck detail loads full cards (incl. images) on demand — keeps the list light. */
  async function open(id: string) {
    const deck = await getStore().getDeck(id).catch(() => null);
    setOpenDeck(deck);
    return deck;
  }

  /** Hub action: one review session across every deck (due queue, oldest first). */
  function startAllReview() {
    setReviewing({ id: "", name: t("srs.allDecks"), color: "var(--review)", subject: null });
  }

  if (reviewing) {
    return <ReviewSession deck={reviewing}
      onExit={() => { setReviewing(null); load(); }} />;
  }
  if (openDeck) {
    return <DeckDetail deck={openDeck}
      onBack={() => { setOpenDeck(null); }}
      onReview={() => setReviewing(openDeck)}
      onChanged={() => open(openDeck.id)} />;
  }

  return <DecksList decks={decks} loaded={loaded}
    onOpen={open}
    onStartAll={startAllReview}
    onChanged={async () => { await load(); }} />;
}

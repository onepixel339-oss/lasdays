"use client";

// ═══════════════ SRS shared types + client media helpers ═══════════════

export interface CardRow {
  id: string; front: string; back: string; image: string | null;
  ease: number; intervalDays: number; reps: number; lapses: number; dueAt: string;
}

export interface DeckRow {
  id: string; name: string; subject: string | null; color: string;
  cards?: CardRow[]; dueCount?: number; matureCount?: number; readiness?: number; cardCount?: number;
}

export const DECK_COLORS = ["#B85C38", "#6F7D45", "#B98F35", "#A85D68", "#98805B", "#5C7A8A"];

/** downscale to ≤768px JPEG data URL — keeps DB rows and API payloads small */
export async function pickImage(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 768 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    const data = cv.toDataURL("image/jpeg", 0.75);
    // refuse to queue anything the API would silently drop (> ~600KB)
    return data.length <= 800_000 ? data : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** CSV: one card per line — front,back (quotes tolerated, header skipped).
 *  Separator: ASCII comma, Arabic comma (U+060C) or fullwidth comma (U+FF0C). */
export function parseCsv(text: string): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^("([^"]*)"|[^,،，]*)(?:[,،，]("([^"]*)"|.*))?$/);
    if (!m) continue;
    const front = (m[2] ?? m[1] ?? "").trim();
    const back = (m[4] ?? m[3] ?? "").trim();
    if (!front || !back) continue;
    if (/^front$/i.test(front) && out.length === 0) continue; // header row
    out.push({ front, back });
    if (out.length >= 500) break;
  }
  return out;
}

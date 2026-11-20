import { ar, type Dict } from "./ar";
import { en } from "./en";

export type Lang = "ar" | "en";

export const dict: Record<Lang, Dict> = { ar, en };

/** Text direction for a language */
export function dirOf(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** Read a dotted path like "home.streak" from a dictionary */
export function translate(lang: Lang, path: string, vars?: Record<string, string | number>): string {
  let cur: unknown = dict[lang] as unknown;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  let out = typeof cur === "string" ? cur : path;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

// ═══════════════ Static content shared by both languages ═══════════════

/** Daily wisdom quotes (ar / en) */
export const QUOTES: { ar: string; en: string }[] = [
  { ar: "وَأَنْ لَيْسَ لِلْإِنْسَانِ إِلَّا مَا سَعَىٰ", en: "And that man shall have nothing but what he strives for" },
  { ar: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ", en: "Seek help through patience and prayer" },
  { ar: "إِنَّ مَعَ الْعُسْرِ يُسْرًا", en: "Indeed, with hardship comes ease" },
  { ar: "الدرر لا تُجمع من الأسهل — قلّة ثابتة خير", en: "Pearls are never gathered easily — steady consistency wins" },
  { ar: "من سار على الدرب وصل", en: "Whoever keeps walking the path, arrives" },
  { ar: "العلم في الصغر كالنقش على الحجر", en: "Knowledge in youth is engraved in stone" },
  { ar: "لا تنسَ ذكر الله — فهو طمأنينة القلب", en: "Never forget remembrance of God — it calms the heart" },
  { ar: "خير الأمور أوسطها — لا تقهر نفسك، ولا تليّن", en: "Balance is best — neither crush yourself nor go soft" },
  { ar: "أعقل المذاكرة: فهم اليوم، وتثبيت الأمس، ومعاينة الغد", en: "Smart study: understand today, solidify yesterday, glance at tomorrow" },
  { ar: "بعد آخر أيام… يجزئ الله الجهد", en: "In the last days… may God accept the effort" },
];

// ═══════════════ Monogram avatar tints ═══════════════
// The avatar is the first letter of the display name set on a warm tinted
// circle — a book-cover monogram, not an emoji. Personalisation = tint.

export const AVATAR_TINTS = ["amber", "moss", "clay", "dusk", "wine"] as const;
export type AvatarTint = (typeof AVATAR_TINTS)[number];

export const AVATAR_TINT_HEX: Record<AvatarTint, string> = {
  amber: "#A84F2B",
  moss: "#3D6B54",
  clay: "#7A5230",
  dusk: "#44586E",
  wine: "#7C3E52",
};

/** Resolve a stored avatar string to a tint — legacy emoji values fall back to amber. */
export function avatarTintOf(avatar: string | undefined): AvatarTint {
  return AVATAR_TINTS.includes((avatar ?? "") as AvatarTint) ? (avatar as AvatarTint) : "amber";
}

/** First letter of a display name, for the monogram circle. */
export function initialOf(name: string | undefined): string {
  const s = (name ?? "").trim();
  return s ? s.charAt(0).toLocaleUpperCase() : "·";
}

export type { Dict };

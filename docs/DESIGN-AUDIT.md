# Stage 2 — Product & UX Audit + Design Direction

## A. Audit findings (all screens inspected)

**What works (kept):**
- Name-only auth with honest disclosure; guest path.
- One data-contract (DataStore) behind every screen — REST/local parity.
- Cairo-calendar day logic everywhere (correct for the audience).
- Mobile dock + desktop rail split; RTL/LTR via `dir` per page.
- Feature completeness: tasks, notes, sprints, exams, focus+ambience+scratchpad,
  SRS (decks/cards/images/CSV), stats, Quran radio+reciters, settings, backup.

**Problems found:**

1. **Visual identity** — "Aurora Night": glassmorphism everywhere (20–28px
   blur on cards, header, dock), two-tone gradient buttons/text/borders,
   animated aurora blobs + dot-grid texture + glow pulses. Reads as generic
   AI-SaaS. High visual noise on a study tool that should recede.
2. **Typography** — mixed micro sizes (10/11/12px chips), inconsistent heading
   levels, no spacing scale; Cairo used well but drowned by effects.
3. **Information architecture** — 9 flat destinations; notes/sprints/stats/
   quran/settings hidden behind "more" on mobile with no desktop grouping.
4. **Dashboard order** — exams first (highest anxiety, not highest utility);
   quick-actions section duplicates the dock; three stat chips + separate plan
   + sprint + quote = 7 stacked sections before any action.
5. **States** — empty states are bare one-liners with no guidance or CTA;
   loading states are plain text in some pages, spinners in others.
6. **Consistency** — button radii vary (full/xl/2xl); row styles differ between
   pages (bg-accent rows vs card-soft rows); two different segmented-control
   styles.
7. **Responsive** — desktop is a centered mobile column (max-w-3xl) with a
   rail; tablets get the mobile dock + wide column — no use of width.
8. **Accessibility** — decorative effects reduce contrast; focus rings mostly
   default; good aria usage in interactive controls (kept).

## B. New design system — "هدوء الدراسة" (Quiet Study)

Calm, editorial, ink-on-paper. The tool disappears; the content leads.

- **Surfaces**: opaque cards on a warm neutral background; 1px hairline
  borders; ONE elevation shadow reserved for floating elements (dock, sheets,
  dialogs). No backdrop blur, no glass.
- **Color**: warm-neutral dark (#0d0e13 / card #16171d) and warm paper light
  (#f4f3ef / card #ffffff). One accent at a time (5 user-selectable accents),
  used only for: active nav state, primary action, key numbers, links.
  Gradients are gone — solid accent buttons, accent-colored headings numbers.
- **Typography**: Cairo (display, headings + numerals) / IBM Plex Sans Arabic
  (body). Scale: 11 chip / 13 caption / 15 body / 18 emphasis / 22 section /
  28 page / 36 hero. Arabic body line-height 1.8; numbers tabular.
- **Spacing**: 4pt grid; page gutter 16px mobile / 24px desktop; card padding
  16px; section gap 20px.
- **Radii**: controls 12px, cards 18px, hero/sheets 24px, pills full.
- **Shadow**: `--shadow-soft` = 0 1px 2px (cards, barely visible);
  `--shadow-pop` = 0 12px 32px -12px (floating only).
- **Backdrop**: plain background + one static, ultra-subtle accent wash at the
  very top (6% opacity). No animated blobs, no dot grid, no glow.
- **Motion**: 160–200ms color/transform transitions; single 240ms fade-up on
  route change; breathing opacity (not glow) for live audio state. All
  disabled under `prefers-reduced-motion`.
- **Iconography**: lucide, 1.75 stroke, size 18/20; icons de-emphasized
  (muted) except in active/primary states.
- **Interaction states**: hover = accent-tinted surface; active nav = accent
  pill (mobile) / accent end-bar (desktop); pressed = scale 0.98.

## C. Information architecture

Desktop rail gains three labeled groups (micro-caps):

- الدراسة / Study: الرئيسية (home), تركيز (focus), المراجعة (srs)
- التخطيط / Plan: المهام (tasks), الملاحظات (notes), السبرنت (sprints)
- الهدوء & النظام / Calm & System: الطمأنينة (quran), الإحصائيات (stats),
  الإعدادات (settings)

Mobile keeps the proven 4+more dock but the "more" sheet becomes a clean
grouped grid. The header simplifies: app name (mobile), focus-minutes chip,
avatar menu.

**Dashboard order** (utility-first): Today hero (greeting + date + focus
minutes + one primary CTA "start focus") → two compact stat cards (due cards /
open tasks) → today's plan list → exam countdowns → active sprint → daily
wisdom. Quick-actions section removed (the dock is the quick action).
Empty states gain guidance + CTA.

## D. Responsive

- Mobile (<md): dock, single column, 16px gutters.
- Tablet (md–lg): rail (icons+labels), content widens to 640px, 2-col grids
  where content allows (decks, stats cards).
- Desktop (lg+): grouped rail, content 720px, comfortable 24px gutters;
  page-level forms may use 2-col layouts (exam dialog).

RTL and LTR are layout-mirrored via logical properties already in use;
the new system uses only logical spacing (ps/pe/ms/me) — verified per page.

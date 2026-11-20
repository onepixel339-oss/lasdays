"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, Timer, Brain, CircleCheckBig, BarChart3, NotebookPen, BookOpen, MoonStar, Settings,
  Ellipsis, type LucideIcon,
} from "lucide-react";
import { useApp } from "./providers";
import { getStore } from "@/lib/datastore";
import { avatarTintOf, AVATAR_TINT_HEX, initialOf } from "@/i18n";
import { RemindersBar } from "./reminders-bar";
import { SwUpdate } from "./sw-update";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ═══════════════ App Shell — دفتر آخر النهار ═══════════════
// Mobile: solid dock (4 primary + more sheet with labeled groups).
// Desktop: grouped rail (الدراسة / التخطيط / الهدوء والنظام) on journal paper.
// Header: name (mobile), focus-minutes chip, avatar menu.
// Desktop content breathes: max-w-5xl — no narrow column lost in empty space.

const MAIN: { href: string; icon: LucideIcon; key: string }[] = [
  { href: "/home", icon: Home, key: "nav.home" },
  { href: "/focus", icon: Timer, key: "nav.focus" },
  { href: "/srs", icon: Brain, key: "nav.srs" },
  { href: "/tasks", icon: CircleCheckBig, key: "nav.tasks" },
];
const PLAN: { href: string; icon: LucideIcon; key: string }[] = [
  { href: "/notes", icon: NotebookPen, key: "nav.notes" },
  { href: "/sprints", icon: BookOpen, key: "nav.sprint" },
];
const CALM: { href: string; icon: LucideIcon; key: string }[] = [
  { href: "/quran", icon: MoonStar, key: "nav.quran" },
  { href: "/stats", icon: BarChart3, key: "nav.stats" },
  { href: "/settings", icon: Settings, key: "nav.settings" },
];
const MORE = [...PLAN, ...CALM];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, me, t, lang, dir } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  React.useEffect(() => {
    if (ready && !me) router.replace("/");
  }, [ready, me, router]);

  // close the more-sheet on navigation
  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // close the more-sheet with Escape (accessibility)
  React.useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  if (!ready || !me) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <MoonStar className="size-8 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  const moreActive = MORE.some((item) => pathname.startsWith(item.href));

  return (
    <div className="min-h-dvh flex" dir={dir}>
      {/* ── desktop rail — the journal spine ── */}
      <aside className="hidden md:flex flex-col gap-1 w-60 shrink-0 border-e border-border bg-sidebar px-3 py-5 sticky top-0 h-dvh overflow-y-auto">
        <Brand />
        <nav className="mt-6 flex flex-col gap-5" aria-label={t("nav.more")}>
          <RailGroup label={t("nav.groupStudy")} items={MAIN} pathname={pathname} />
          <RailGroup label={t("nav.groupPlan")} items={PLAN} pathname={pathname} />
          <RailGroup label={t("nav.groupCalm")} items={CALM} pathname={pathname} />
        </nav>
        <div className="mt-auto" />
        <p className="px-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("common.tagline")}
        </p>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* ── header ── */}
        <header className="sticky top-0 z-40 pt-safe">
          <div className="border-b border-border bg-background/95">
            <div className="mx-auto max-w-5xl px-4 md:px-6 h-14 flex items-center gap-2">
              <span className="md:hidden font-display text-lg font-bold tracking-tight text-foreground">
                {t("common.appName")}
              </span>
              <div className="flex-1" />
              {/* today's study minutes — real productivity signal */}
              <TodayFocus lang={lang} />
              {/* avatar menu — monogram on a warm tint, no emoji */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="grid size-10 place-items-center rounded-full font-display text-base font-bold tap transition-transform active:scale-95"
                    style={{
                      background: AVATAR_TINT_HEX[avatarTintOf(me.avatar)],
                      color: "#FFFEFA",
                      boxShadow: "inset 0 0 0 1px rgba(255,254,250,0.18)",
                    }}
                    aria-label={t("settings.profile")}
                  >
                    {initialOf(me.isGuest && me.username.startsWith("guest_") ? t("auth.guestName") : me.username)}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={dir === "rtl" ? "start" : "end"} className="rounded-xl">
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">{me.isGuest ? t("auth.guestName") : me.username}</div>
                  <DropdownMenuItem onClick={() => router.push("/settings")} className="gap-2">
                    <Settings className="size-4" /> {t("nav.settings")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/quran")} className="gap-2">
                    <MoonStar className="size-4" /> {t("nav.quran")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* ── page (re-animates on navigation) ── */}
        <main className="flex-1 w-full">
          <div key={pathname} className="rise mx-auto w-full max-w-5xl px-4 md:px-6 pt-4 md:pt-6 pb-32 md:pb-12">
            {/* in-app reminders (once per day, on app open) + update notice */}
            <RemindersBar />
            <SwUpdate />
            {children}
          </div>
        </main>
      </div>

      {/* ── mobile dock: 4 primary + more ── */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 pb-safe" aria-label={t("nav.more")}>
        <div className="mx-3 mb-2 rounded-2xl glass px-1.5 py-1.5">
          <ul className="flex items-stretch justify-between">
            {MAIN.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-colors tap ${
                      active ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`grid size-9 place-items-center rounded-lg transition-colors ${
                        active ? "bg-primary/12" : ""
                      }`}
                    >
                      <item.icon className="size-5" strokeWidth={active ? 2.2 : 1.75} />
                    </span>
                    {t(item.key)}
                  </Link>
                </li>
              );
            })}
            {/* more trigger */}
            <li className="flex-1">
              <button
                onClick={() => setMoreOpen(true)}
                aria-label={t("nav.more")}
                aria-expanded={moreOpen}
                className={`flex w-full min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-colors tap ${
                  moreActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`grid size-9 place-items-center rounded-lg transition-colors ${
                    moreActive ? "bg-primary/12" : ""
                  }`}
                >
                  <Ellipsis className="size-5" />
                </span>
                {t("nav.more")}
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {/* ── more sheet — grouped ── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("nav.more")}>
          <button
            aria-label={t("common.close")}
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <div className="rise absolute inset-x-0 bottom-0 pb-safe">
            <div className="mx-3 mb-2 rounded-2xl glass p-4">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/20" />
              <div className="grid grid-cols-3 gap-3">
                <SheetGroup label={t("nav.groupPlan")} items={PLAN} pathname={pathname} />
                <SheetGroup label={t("nav.groupCalm")} items={CALM} pathname={pathname} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Rail group with a micro-caps label */
function RailGroup({ label, items, pathname }: { label: string; items: { href: string; icon: LucideIcon; key: string }[]; pathname: string }) {
  const { t } = useApp();
  return (
    <div>
      <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-primary/12 font-semibold text-primary" : "text-foreground/75 hover:bg-accent hover:text-foreground"
              }`}
            >
              <item.icon className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.75} />
              {t(item.key)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Grid group inside the mobile more-sheet */
function SheetGroup({ label, items, pathname }: { label: string; items: { href: string; icon: LucideIcon; key: string }[]; pathname: string }) {
  const { t } = useApp();
  return (
    <div>
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-16 flex-col items-start justify-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors tap ${
                active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-foreground/80"
              }`}
            >
              <item.icon className="size-5" strokeWidth={active ? 2.2 : 1.75} />
              <span className="w-full truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Live "focus minutes today" chip — the honest productivity signal. */
function TodayFocus({ lang }: { lang: string }) {
  const { t } = useApp();
  const [min, setMin] = React.useState<number | null>(null);
  React.useEffect(() => {
    let alive = true;
    getStore().getTodaySessions().then((d) => {
      if (alive) setMin(Math.round((d?.todaySec ?? 0) / 60));
    }).catch(() => null);
    return () => { alive = false; };
  }, [lang]);
  if (min == null) return null;
  return (
    <Link
      href="/stats"
      className="flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-semibold tap transition-transform active:scale-95"
    >
      <Timer className="size-4 text-primary" />
      <span className="num-tabular">{min}</span>
      <span className="text-[10px] text-muted-foreground">{t("common.min")}</span>
    </Link>
  );
}

/** Brand mark — a journal page with a folded corner and an amber horizon dot. */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    <span className={`grid ${className} shrink-0 place-items-center rounded-xl border border-border bg-card`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" className="size-6">
        {/* page with folded corner */}
        <path
          d="M6 3.5h8.5L19 8v12.5H6z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          className="text-foreground"
        />
        <path d="M14.5 3.5V8H19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="text-foreground" />
        {/* amber horizon dot */}
        <circle cx="12.5" cy="14.5" r="2.2" className="fill-primary" />
      </svg>
    </span>
  );
}

function Brand() {
  const { t } = useApp();
  return (
    <div className="flex items-center gap-2.5 px-2">
      <BrandMark className="size-10" />
      <div className="min-w-0">
        <div className="font-display text-lg font-bold leading-tight">{t("common.appName")}</div>
        <div className="text-[11px] leading-tight text-muted-foreground">{t("common.tagline")}</div>
      </div>
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SWRegister } from "@/components/SWRegister";
import { AppProvider } from "@/components/providers";

// ═══════════════ دفتر آخر النهار — one typeface, weight contrast ═══════════════
// IBM Plex Sans Arabic carries Arabic AND Latin (its Latin glyphs are the
// Plex family design), so headings and body stay one quiet voice.

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-app-body",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "آخر أيام — رفيق الانضباط",
  description:
    "رفيقك للمذاكرة والمراجعة الذكية: جلسات تركيز، بطاقات تكرار متباعد، مهام وسبرنت صفحات — بدون ألعاب، تركيز على التعلم.",
  applicationName: "آخر أيام",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "آخر أيام" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // zoom stays enabled — it is an accessibility requirement
  viewportFit: "cover",
  themeColor: "#111316",
};

/** Applied before first paint: prevents a flash of the wrong theme/direction. */
const prePaintScript = `(function(){try{
var p=JSON.parse(localStorage.getItem("ld2_prefs")||"{}");
var l=p.lang==="en"?"en":"ar";
var th=p.theme==="light"?"light":"dark";
var ac=p.accent||"amber";
var el=document.documentElement;
el.lang=l;el.dir=l==="en"?"ltr":"rtl";
el.classList.toggle("dark",th==="dark");
el.dataset.accent=ac;
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        className={`${ibmPlexArabic.variable} antialiased bg-background text-foreground`}
      >
        {/* pre-paint prefs (theme/lang/dir) — runs before any paint */}
        <script dangerouslySetInnerHTML={{ __html: prePaintScript }} />
        {/* end-of-day journal backdrop — a single static accent wash */}
        <div className="app-tint" aria-hidden />
        {/* single app-wide provider — theme, language, session */}
        <AppProvider>
          {children}
          <Toaster />
          <SWRegister />
        </AppProvider>
      </body>
    </html>
  );
}

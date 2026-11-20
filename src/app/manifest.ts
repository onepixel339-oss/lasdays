import type { MetadataRoute } from "next";

// Required by output: "export" — the manifest is a build-time static asset.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "آخر أيام — رفيق الانضباط",
    short_name: "آخر أيام",
    description:
      "رفيقك للمذاكرة والمراجعة الذكية: جلسات تركيز، بطاقات متباعدة، مهام، وسبرنت صفحات.",
    id: "/",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#06070f",
    theme_color: "#06070f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "ابدأ جلسة تركيز",
        short_name: "تركيز",
        url: "/focus",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "راجع البطاقات",
        short_name: "مراجعة",
        url: "/srs",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}

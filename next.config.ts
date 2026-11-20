import type { NextConfig } from "next";

// ═══════════════ Last Days — static PWA ═══════════════
// output: "export" → `next build` produces a fully static site in out/.
// No Node.js server, no API routes, no server code: hosting is any static
// file host (Vercel / Netlify / Cloudflare Pages / any CDN).
//
// next.config headers() is NOT applied to static exports — per-host header
// recipes (security headers, sw.js no-cache) live in DEPLOY.md + vercel.json.

const nextConfig: NextConfig = {
  output: "export",
  // TypeScript errors and ESLint errors must fail the build — no silent shipping.
  reactStrictMode: true,
};

export default nextConfig;

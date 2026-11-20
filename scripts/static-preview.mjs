#!/usr/bin/env node
// ═══════════════ Static hosting preview — serves out/ like a real static host ═══════════════
// Mimics Vercel/Netlify/Cloudflare Pages behavior for the exported app:
//   • clean URLs: /home → home.html (or home/index.html)
//   • correct MIME types (incl. .webmanifest)
//   • /_next/static/* served immutable (fingerprinted build assets)
//   • /sw.js served no-cache (the SW must always be fresh)
//   • directory index for "/" → index.html
// Usage: node scripts/static-preview.mjs [port]   (default 4173, root = ../out)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(import.meta.url)), "../../out");
const PORT = Number(process.argv[2] ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".map": "application/json",
};

/** Resolve a URL path to a file inside out/ (null = 404). */
async function resolveFile(urlPath) {
  const clean = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const base = join(ROOT, clean);
  // 1. exact file (/index.html, /sw.js, /_next/static/...)
  try {
    if ((await stat(base)).isFile()) return base;
  } catch { /* keep trying */ }
  // 2. clean URL → .html file (/home → home.html)
  try {
    const withHtml = `${base}.html`;
    if ((await stat(withHtml)).isFile()) return withHtml;
  } catch { /* keep trying */ }
  // 3. clean URL → directory index (/home → home/index.html)
  try {
    const idx = join(base, "index.html");
    if ((await stat(idx)).isFile()) return idx;
  } catch { /* fallthrough */ }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("method not allowed");
      return;
    }
    const file = await resolveFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`not found: ${url.pathname}`);
      return;
    }
    const ext = extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const headers = { "content-type": type };
    if (url.pathname === "/sw.js" || url.pathname.endsWith("/sw.js")) {
      headers["cache-control"] = "no-cache, no-store, must-revalidate";
      headers["service-worker-allowed"] = "/";
    } else if (url.pathname.startsWith("/_next/static/")) {
      headers["cache-control"] = "public, max-age=31536000, immutable";
    } else if (ext === ".html") {
      headers["cache-control"] = "no-cache";
    } else {
      headers["cache-control"] = "public, max-age=3600";
    }
    const body = await readFile(file);
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("server error");
  }
});

server.listen(PORT, () => {
  console.log(`static preview → http://localhost:${PORT}/  (root: ${ROOT})`);
});

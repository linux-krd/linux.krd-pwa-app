/*
 * Linux.krd PWA
 * Copyright (C) 2026 Linux.krd
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
/* Service Worker — لینوکس بە کوردی */
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const IMG = `img-${VERSION}`;
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, IMG].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

// network-first: API (بابەتە نوێیەکان)، لە کاتی نەبوونی ئینتەرنێت cache
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) { cache.put(req, res.clone()); trim(cacheName, 80); }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error("offline");
  }
}
// stale-while-revalidate: فایلەکانی ئەپ، وێنە، فۆنت
async function swr(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") { cache.put(req, res.clone()); if (max) trim(cacheName, max); } return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.includes("/wp-json/")) return e.respondWith(networkFirst(req, DATA));
  if (url.origin === location.origin) {
    if (req.mode === "navigate") return e.respondWith(caches.match("index.html").then((r) => r || fetch(req)));
    return e.respondWith(swr(req, SHELL));
  }
  if (req.destination === "image") return e.respondWith(swr(req, IMG, 120));
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com")) return e.respondWith(swr(req, SHELL));
});

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
/* لینوکس بە کوردی — PWA
 * بابەتەکان لە REST API ـی وردپرێس (WordPress) ـی ماڵپەڕ دەخوێنرێنەوە.
 * ڕێکخستنەکان لێرە بگۆڕە: */
const CONFIG = {
  site: "https://linux.krd", // ناونیشانی ماڵپەڕ (بێ / لە کۆتاییدا)
  perPage: 10,
  wordsPerMinute: 180,
  sliderCount: 3,    // ژمارەی پڕۆژەکانی ئەسلایدەر
  sliderCategory: 0, // ئەگەر ID ی بەشی «پڕۆژەکان» لێرە بنووسیت، ئەسلایدەر لەو بەشە دەخوێنرێتەوە
};

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const API = (path) => `${CONFIG.site}/wp-json/wp/v2/${path}`;

/* ---------- storage / state ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let saved = store.get("saved", {});     // id -> post
const postCache = new Map();            // id -> post
let categories = store.get("cats", []); // [{id,name,count}]

/* ---------- helpers ---------- */
const decode = (html) => { const t = document.createElement("textarea"); t.innerHTML = html || ""; return t.value; };
const strip = (html) => decode((html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const locales = ["ckb-IQ", "ckb", "ar-IQ", undefined];
function fmt(iso, opts) {
  const d = new Date(iso);
  for (const loc of locales) { try { return d.toLocaleDateString(loc, opts); } catch {} }
  return d.toDateString();
}
const fmtDate = (iso) => fmt(iso, { year: "numeric", month: "long", day: "numeric" });
const fmtShort = (iso) => fmt(iso, { month: "short", day: "numeric" });
const readMin = (html) => Math.max(1, Math.round(strip(html).split(" ").length / CONFIG.wordsPerMinute));
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "ئێستا";
  const m = s / 60; if (m < 60) return `${Math.floor(m)} خولەک لەمەوبەر`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)} کاتژمێر لەمەوبەر`;
  const d = h / 24; if (d < 7) return `${Math.floor(d)} ڕۆژ لەمەوبەر`;
  if (d < 30) return `${Math.floor(d / 7)} هەفتە لەمەوبەر`;
  return fmtDate(iso);
}
const TAGC = ["#f97316", "#6d4fc2", "#0ea5e9", "#10b981", "#ec4899", "#d97706"];
const tagColor = (name) => { let h = 0; for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TAGC[h % TAGC.length]; };
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
function normalize(p) {
  const media = p._embedded?.["wp:featuredmedia"]?.[0];
  const sizes = media?.media_details?.sizes;
  const img = sizes?.large?.source_url || sizes?.medium_large?.source_url || media?.source_url || "";
  const thumb = sizes?.medium?.source_url || sizes?.medium_large?.source_url || img;
  const term = p._embedded?.["wp:term"]?.[0]?.[0];
  return {
    id: p.id, link: p.link, date: p.date, modified: p.modified || p.date,
    title: decode(p.title?.rendered), excerpt: strip(p.excerpt?.rendered),
    content: p.content?.rendered || "", img, thumb, cat: decode(term?.name || ""), catId: term?.id || 0,
  };
}

const I = {
  bm: '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  textp: '<svg viewBox="0 0 24 24"><path d="M4 20l5-14 5 14M6 15h6M18 8v6M15 11h6"/></svg>',
  textm: '<svg viewBox="0 0 24 24"><path d="M4 20l5-14 5 14M6 15h6M15 11h6"/></svg>',
};

/* ---------- network ---------- */
async function wp(path) {
  const res = await fetch(API(path));
  if (!res.ok) throw new Error(res.status);
  return { data: await res.json(), pages: +(res.headers.get("X-WP-TotalPages") || 1) };
}
const EMBED = "wp:featuredmedia,wp:term";

class Pager {
  constructor(o = {}) { this.category = o.category || 0; this.query = o.query || ""; this.posts = []; this.page = 1; this.pages = 1; this.loading = false; this.error = false; }
  get hasMore() { return this.page < this.pages; }
  async load(reset) {
    if (this.loading) return;
    this.loading = true;
    if (reset) { this.posts = []; this.page = 1; }
    const q = new URLSearchParams({ per_page: CONFIG.perPage, page: this.page, _embed: EMBED });
    if (this.category) q.set("categories", this.category);
    if (this.query) q.set("search", this.query);
    try {
      const { data, pages } = await wp("posts?" + q);
      this.pages = pages;
      const items = data.map(normalize);
      items.forEach((p) => postCache.set(p.id, p));
      this.posts = this.posts.concat(items);
      this.error = false;
    } catch { this.error = true; }
    this.loading = false;
  }
  async more() { this.page++; await this.load(false); if (this.error) this.page--; }
}
const home = new Pager();
const searchPager = new Pager();

async function loadCategories() {
  try {
    const { data } = await wp("categories?per_page=50&hide_empty=true&orderby=count&order=desc&_fields=id,name,count,slug");
    categories = data.filter((c) => c.slug !== "uncategorized").map((c) => ({ id: c.id, name: decode(c.name), count: c.count }));
    store.set("cats", categories);
  } catch {}
  paintDrawer();
}

/* ---------- row / slide templates ---------- */
const catTag = (p) => (p.cat ? `<span class="ctag" style="--tc:${tagColor(p.cat)}">${esc(p.cat)}</span>` : "");
function rowHTML(p) {
  return `<div class="row" role="button" tabindex="0" data-open="${p.id}">
    <div class="thumb ${p.thumb ? "" : "empty"}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : "$_"}</div>
    <div class="info">${catTag(p)}<h3>${esc(p.title)}</h3>
      <div class="meta">${I.clock}<span>${ago(p.date)}</span><span class="sp"></span>
        <button class="bm ${saved[p.id] ? "on" : ""}" data-bm="${p.id}" aria-label="پاشەکەوت">${I.bm}</button></div></div></div>`;
}
const skRows = (n = 4) => Array.from({ length: n }, () => '<div class="sk-row"></div>').join("");
function paintRows(pager, list, moreWrap, kind) {
  if (!list) return;
  if (!pager.posts.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">404</div>
      <p>${pager.error ? "نەتوانرا بابەتەکان باربکرێن" : "هیچ بابەتێک نەدۆزرایەوە"}</p>
      ${pager.error ? `<button data-retry="${kind}">هەوڵ بدەرەوە</button>` : ""}</div>`;
    if (moreWrap) moreWrap.innerHTML = ""; return;
  }
  list.innerHTML = pager.posts.map(rowHTML).join("");
  if (moreWrap) moreWrap.innerHTML = pager.hasMore ? `<button class="more" data-more="${kind}">زیاتر نیشان بدە</button>` : "";
}

/* ---------- home ---------- */
let sliderTimer, sliderPaused = false;
async function viewHome() {
  setTab("home");
  app.innerHTML = `<div class="view">
    <div class="slider-wrap"><div class="slider" id="slider"><div class="slide sk"></div><div class="slide sk"></div></div><div class="dots" id="dots"></div></div>
    <div class="sec-head"><h2>نوێترین بابەتەکانی هەموو بەشەکان</h2><button class="link" data-more="home">زیاتر</button></div>
    <div class="rows" id="list">${skRows()}</div><div id="moreWrap"></div></div>`;
  loadSlider();
  const paint = () => paintRows(home, $("#list"), $("#moreWrap"), "home");
  if (home.posts.length) paint();
  else {
    await home.load(true);
    if (home.error) home.posts = store.get("home", []);
    else store.set("home", home.posts.map(({ content, ...r }) => r));
    paint();
  }
  updateUpdated(home.posts);
}
async function loadSlider() {
  const el = $("#slider"); if (!el) return;
  const want = CONFIG.sliderCount;
  const base = { per_page: want, _embed: EMBED };
  if (CONFIG.sliderCategory) base.categories = CONFIG.sliderCategory;
  let items = [];
  try {
    const map = new Map();
    if (!CONFIG.sliderCategory) {
      try { (await wp("posts?" + new URLSearchParams({ ...base, sticky: "true" }))).data.forEach((p) => map.set(p.id, p)); } catch {}
    }
    if (map.size < want) (await wp("posts?" + new URLSearchParams(base))).data.forEach((p) => { if (map.size < want) map.set(p.id, p); });
    items = [...map.values()].map(normalize);
    items.forEach((p) => postCache.set(p.id, p));
    store.set("slider", items.map(({ content, ...r }) => r));
  } catch { items = store.get("slider", []); }
  if (!$("#slider")) return;
  const dots = $("#dots");
  if (!items.length) { el.innerHTML = ""; dots.innerHTML = ""; return; }
  el.innerHTML = items.map((p) => `<div class="slide" role="button" tabindex="0" data-open="${p.id}">
      ${p.img ? `<img src="${esc(p.img)}" alt="">` : '<div class="ph">$_</div>'}<div class="shade"></div>
      <div class="cap">${catTag(p)}<h2>${esc(p.title)}</h2><div class="meta">${I.clock}<span>${ago(p.date)}</span></div></div></div>`).join("");
  dots.innerHTML = items.length > 1 ? items.map((_, i) => `<button data-dot="${i}" aria-label="${i + 1}"></button>`).join("") : "";
  startSlider();
}
function startSlider() {
  const el = $("#slider"); if (!el) return;
  const slides = [...el.children], dots = [...$("#dots").children];
  let cur = 0;
  dots[0]?.classList.add("on");
  if (slides.length < 2) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { cur = slides.indexOf(e.target); dots.forEach((d, j) => d.classList.toggle("on", j === cur)); }
  }), { root: el, threshold: 0.6 });
  slides.forEach((s) => io.observe(s));
  let resume;
  const pause = () => { sliderPaused = true; clearTimeout(resume); resume = setTimeout(() => (sliderPaused = false), 6000); };
  el.addEventListener("pointerdown", pause); el.addEventListener("wheel", pause, { passive: true });
  $("#dots").addEventListener("click", (e) => { const b = e.target.closest("[data-dot]"); if (b) { pause(); slides[+b.dataset.dot].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } });
  clearInterval(sliderTimer);
  sliderTimer = setInterval(() => {
    if (!document.body.contains(el)) return clearInterval(sliderTimer);
    if (sliderPaused || document.hidden || document.body.classList.contains("lock")) return;
    cur = (cur + 1) % slides.length;
    slides[cur].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, 5000);
}
function updateUpdated(posts) {
  let iso = posts?.length ? posts.reduce((a, p) => (p.modified > a ? p.modified : a), "") : "";
  if (iso) store.set("updated", iso); else iso = store.get("updated", "");
  if (!iso) return;
  $("#updatedText").textContent = fmtShort(iso);
  $("#updated").hidden = false;
}

/* ---------- search / saved ---------- */
function viewSearch() {
  setTab("search");
  app.innerHTML = `<div class="view"><div class="searchbox">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    <input id="q" type="search" placeholder="گەڕان لە بابەتەکان…" value="${esc(searchPager.query)}" enterkeyhint="search"></div>
    <div class="rows" id="list"></div><div id="moreWrap"></div></div>`;
  const input = $("#q"), list = $("#list"), more = $("#moreWrap");
  let t;
  const run = async () => {
    searchPager.query = input.value.trim();
    if (!searchPager.query) { list.innerHTML = '<div class="empty-state"><div class="big">grep _</div><p>وشەیەک بنووسە بۆ گەڕان</p></div>'; more.innerHTML = ""; return; }
    list.innerHTML = skRows(3);
    await searchPager.load(true);
    paintRows(searchPager, list, more, "search");
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 450); });
  run();
}
function viewSaved() {
  setTab("saved");
  const items = Object.values(saved).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  app.innerHTML = `<div class="view"><h2 class="section-title">بابەتە پاشەکەوتکراوەکان</h2>
    ${items.length ? `<div class="rows">${items.map(rowHTML).join("")}</div>` :
      '<div class="empty-state"><div class="big">ls -a</div><p>هێشتا هیچ بابەتێکت پاشەکەوت نەکردووە.<br>لە لیستەکان نیشانەی بووکمارک دابگرە.</p></div>'}</div>`;
}

/* ---------- drawer ---------- */
function paintDrawer() {
  $("#drawerCats").innerHTML = categories.length
    ? categories.map((c) => `<button class="dcat" data-catopen="${c.id}" data-name="${esc(c.name)}" data-count="${c.count || ""}">
        <span class="dot" style="--tc:${tagColor(c.name)}"></span><span class="nm">${esc(c.name)}</span>${c.count ? `<span class="cnt">${c.count}</span>` : ""}</button>`).join("")
    : '<p style="color:var(--muted);padding:8px 12px;font-size:13px">بەشەکان بار نەبوون</p>';
}
const openDrawer = () => document.body.classList.add("drawer-open");
const closeDrawer = () => document.body.classList.remove("drawer-open");

/* ---------- bottom sheet (stack, بەستراوە بە history بۆ دوگمەی گەڕانەوە) ---------- */
const sheetStack = [];
let renderToken = 0;
const topEntry = () => sheetStack[sheetStack.length - 1];

function pushSheet(entry) {
  const cur = topEntry(); if (cur) cur.scroll = $("#sheetBody").scrollTop;
  sheetStack.push(entry);
  history.pushState({ depth: sheetStack.length }, "");
  renderSheet();
}
const closeAllSheets = () => { if (sheetStack.length) history.go(-sheetStack.length); };
addEventListener("popstate", (e) => {
  const d = e.state?.depth || 0;
  if (d < sheetStack.length) { sheetStack.length = d; renderSheet(); }
});

function renderSheet() {
  const top = topEntry(), wrap = $("#sheetWrap"), body = $("#sheetBody");
  const token = ++renderToken;
  if (!top) { wrap.classList.remove("open"); document.body.classList.remove("lock"); document.title = "لینوکس بە کوردی"; return; }
  closeDrawer();
  wrap.classList.add("open"); document.body.classList.add("lock");
  $("#sheetBack").hidden = sheetStack.length < 2;
  $("#sheetProg").style.width = "0";
  body.scrollTop = 0;
  if (top.type === "post") renderPost(top, body, token); else renderCat(top, body);
  if (top.scroll) requestAnimationFrame(() => (body.scrollTop = top.scroll));
}

async function renderPost(entry, body, token) {
  $("#sheetTitle").textContent = "بابەت";
  body.innerHTML = '<div class="rows" style="margin-top:12px">' + skRows(1) + skRows(1) + "</div>";
  let p = postCache.get(entry.id);
  if (!p?.content && saved[entry.id]?.content) p = saved[entry.id];
  if (!p?.content) {
    try { const { data } = await wp(`posts/${entry.id}?_embed=${EMBED}`); p = normalize(data); postCache.set(p.id, p); }
    catch {
      if (token !== renderToken) return;
      body.innerHTML = '<div class="empty-state"><div class="big">404</div><p>نەتوانرا ئەم بابەتە بکرێتەوە.<br>ئینتەرنێتەکەت بپشکنە.</p></div>'; return;
    }
  }
  if (token !== renderToken) return;
  $("#sheetTitle").textContent = p.cat || "بابەت";
  document.title = p.title + " — لینوکس بە کوردی";
  body.innerHTML = `<article class="article">
    ${p.img ? `<div class="cover"><img src="${esc(p.img)}" alt=""></div>` : ""}
    <h1>${esc(p.title)}</h1>
    <div class="meta">${catTag(p)}<span>${fmtDate(p.date)}</span><span>${readMin(p.content)} خولەک خوێندنەوە</span></div>
    <div class="toolbar">
      <button class="tool ${saved[p.id] ? "on" : ""}" data-bm="${p.id}" aria-label="پاشەکەوت" title="پاشەکەوت">${I.bm}</button>
      <button class="tool" data-share="${p.id}" aria-label="هاوبەشکردن" title="هاوبەشکردن">${I.share}</button>
      <a class="tool" href="${esc(p.link)}" target="_blank" rel="noopener" aria-label="ماڵپەڕ" title="ماڵپەڕ">${I.ext}</a>
      <button class="tool" data-font="1" aria-label="گەورەکردنی نووسین">${I.textp}</button>
      <button class="tool" data-font="-1" aria-label="بچووککردنی نووسین">${I.textm}</button>
    </div><div class="prose" id="prose"></div></article>`;
  $("#prose").appendChild(cleanContent(p.content));
}

function renderCat(entry, body) {
  $("#sheetTitle").textContent = entry.name;
  const pg = entry.pager || (entry.pager = new Pager({ category: entry.id }));
  body.innerHTML = `<div class="cat-head"><span class="ctag" style="--tc:${tagColor(entry.name)}">${esc(entry.name)}</span>${entry.count ? `<span>${esc(entry.count)} بابەت</span>` : ""}</div>
    <div class="rows" id="catList"></div><div id="catMore"></div>`;
  if (pg.posts.length) return paintCat(entry);
  $("#catList").innerHTML = skRows(5);
  pg.load(true).then(() => { if (topEntry() === entry) paintCat(entry); });
}
const paintCat = (entry) => paintRows(entry.pager, $("#catList"), $("#catMore"), "cat");

/* مەحتوا پاک دەکرێتەوە لە سکریپت و کۆدی مەترسیدار */
function cleanContent(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,form,object,embed,noscript,link,meta").forEach((n) => n.remove());
  const okFrame = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|www\.aparat\.com)\//;
  doc.querySelectorAll("iframe").forEach((f) => { if (!okFrame.test(f.src || "")) f.remove(); else { f.removeAttribute("width"); f.removeAttribute("height"); f.loading = "lazy"; } });
  doc.body.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    });
    if (el.tagName === "A" && el.href) { el.target = "_blank"; el.rel = "noopener"; }
    if (el.tagName === "IMG") { el.loading = "lazy"; ["width", "height", "srcset", "sizes"].forEach((a) => el.removeAttribute(a)); }
  });
  doc.body.querySelectorAll("pre").forEach((pre) => {
    const b = document.createElement("button"); b.className = "copy-btn"; b.textContent = "کۆپی"; b.dataset.copy = "1"; pre.appendChild(b);
  });
  const frag = document.createDocumentFragment();
  [...doc.body.childNodes].forEach((n) => frag.appendChild(document.importNode(n, true)));
  return frag;
}

/* ---------- router ---------- */
function setTab(name) { document.querySelectorAll(".dock [data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === name)); }
function route() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/post\/(\d+)/);
  if (m) { history.replaceState({ depth: 0 }, "", "#/"); viewHome(); pushSheet({ type: "post", id: +m[1] }); return; }
  if (sheetStack.length) { sheetStack.length = 0; renderSheet(); }
  closeDrawer();
  window.scrollTo(0, 0);
  if (h.startsWith("#/search")) return viewSearch();
  if (h.startsWith("#/saved")) return viewSaved();
  return viewHome();
}
addEventListener("hashchange", route);

/* ---------- events ---------- */
const pagerFor = (k) => (k === "home" ? home : k === "search" ? searchPager : topEntry()?.pager);
const repaint = (k) => {
  if (k === "cat") return paintCat(topEntry());
  paintRows(pagerFor(k), $("#list"), $("#moreWrap"), k);
};
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-bm],[data-open],[data-catopen],[data-menu],[data-closedrawer],[data-sheetclose],[data-sheetback],[data-more],[data-retry],[data-share],[data-font],[data-copy]");
  if (!t) return;
  const d = t.dataset;
  if (d.bm) {
    e.preventDefault(); e.stopPropagation();
    const id = +d.bm;
    if (saved[id]) { delete saved[id]; toast("لە پاشەکەوتەکان لابرا"); }
    else {
      const p = postCache.get(id) || saved[id];
      if (p) { saved[id] = { ...p, savedAt: Date.now() }; toast("پاشەکەوت کرا — بێ ئینتەرنێتیش دەکرێتەوە"); }
    }
    store.set("saved", saved);
    document.querySelectorAll(`[data-bm="${id}"]`).forEach((b) => b.classList.toggle("on", !!saved[id]));
    if (location.hash.startsWith("#/saved") && !sheetStack.length) viewSaved();
  } else if (d.open) {
    pushSheet({ type: "post", id: +d.open });
  } else if (d.catopen) {
    closeDrawer(); pushSheet({ type: "cat", id: +d.catopen, name: d.name, count: d.count });
  } else if (d.menu !== undefined) { openDrawer();
  } else if (d.closedrawer !== undefined) { closeDrawer();
  } else if (d.sheetclose !== undefined) { closeAllSheets();
  } else if (d.sheetback !== undefined) { history.back();
  } else if (d.more) {
    t.disabled = true; const pg = pagerFor(d.more); if (!pg) return;
    await pg.more(); repaint(d.more);
  } else if (d.retry) {
    const pg = pagerFor(d.retry); if (!pg) return;
    await pg.load(true); repaint(d.retry);
  } else if (d.share) {
    const p = postCache.get(+d.share); if (!p) return;
    if (navigator.share) { try { await navigator.share({ title: p.title, url: p.link }); } catch {} }
    else { try { await navigator.clipboard.writeText(p.link); toast("بەستەر کۆپی کرا"); } catch {} }
  } else if (d.font) {
    const n = Math.min(26, Math.max(14, store.get("fs", 18) + 2 * +d.font));
    store.set("fs", n); document.documentElement.style.setProperty("--read-size", n + "px");
  } else if (d.copy) {
    const code = t.parentElement.querySelector("code")?.innerText ?? t.parentElement.innerText;
    try { await navigator.clipboard.writeText(code.trim()); t.textContent = "کۆپی کرا ✓"; setTimeout(() => (t.textContent = "کۆپی"), 1500); } catch {}
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (document.body.classList.contains("drawer-open")) closeDrawer(); else closeAllSheets(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-open]")) { e.preventDefault(); e.target.click(); }
});
$("#sheetBody").addEventListener("scroll", () => {
  const b = $("#sheetBody");
  if (topEntry()?.type !== "post") return;
  $("#sheetProg").style.width = Math.min(100, (b.scrollTop / Math.max(1, b.scrollHeight - b.clientHeight)) * 100) + "%";
}, { passive: true });

/* ڕاکێشان بۆ خوارەوە بۆ داخستنی پەنجەرە */
(function () {
  const head = $("#sheetHead"), sheet = $("#sheet");
  let y0 = null, dy = 0;
  head.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; dy = 0; sheet.classList.add("drag"); }, { passive: true });
  head.addEventListener("touchmove", (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  head.addEventListener("touchend", () => {
    if (y0 === null) return;
    sheet.classList.remove("drag"); sheet.style.transform = ""; y0 = null;
    if (dy > 110) closeAllSheets();
  });
})();

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#themeColor").content = t === "dark" ? "#0b1220" : "#eef2f7";
  $("#themeIcon").innerHTML = t === "dark"
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
    : '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>';
}
applyTheme(store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
document.documentElement.style.setProperty("--read-size", store.get("fs", 18) + "px");
$("#themeBtn").addEventListener("click", () => {
  const n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  store.set("theme", n); applyTheme(n);
});

/* ---------- online / install / SW ---------- */
const banner = $("#offlineBanner");
const syncNet = () => (banner.hidden = navigator.onLine);
addEventListener("online", syncNet); addEventListener("offline", syncNet); syncNet();

let deferred;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
$("#installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("#installBtn").hidden = true; });
addEventListener("appinstalled", () => ($("#installBtn").hidden = true));
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

/* ---------- start ---------- */
history.replaceState({ depth: 0 }, "");
paintDrawer();
updateUpdated(null);
loadCategories();
route();

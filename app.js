import { worthScore, dadScore, multiplayerScore, isPatient, launchTrend, metascore, ageMonths, fmtN } from "./score.js";

const form = document.getElementById("filters");
const list = document.getElementById("list");
const count = document.getElementById("count");
const more = document.getElementById("more");
const PAGE = 100;
let limit = PAGE;

// My games: {appid: "own"}, kept in this browser only.
const STATUS_KEY = "pgr.status.v1";
let mine = {};
try { mine = JSON.parse(localStorage.getItem(STATUS_KEY)) ?? {}; } catch {}
const saveMine = () => { try { localStorage.setItem(STATUS_KEY, JSON.stringify(mine)); } catch {} };
const owns = (appid) => mine[appid] === "own";
const ownLabel = (own) => (own ? "✓ Owned" : "+ I own this");
// The "Owned" chip says how many games are marked.
const ownedChip = form.querySelector('input[name="mine"][value="own"] + span');
const renderOwnedCount = () => {
  const n = Object.values(mine).filter((s) => s === "own").length;
  ownedChip.textContent = n ? `Owned (${n})` : "Owned";
};

const data = await (await fetch("games.json")).json();
document.getElementById("updated").textContent = data.updated;

// Only patient games: out a year and finished; games a year into Early Access
// come along for the "Incl. Early Access" switch. The data holds every
// candidate, so the rule can change without a new fetch.
const games = data.games.filter((g) => isPatient(g, undefined, true)).map((g) => ({ ...g, age: ageMonths(g), worth: worthScore(g), dad: dadScore(g), mp: multiplayerScore(g) }));
// Banner, stats and the genre and year counts describe the default, finished-only view.
const finished = games.filter((g) => !g.earlyAccess);

// Banner: covers of the 16 best "Worth the wait" patient games, and what the data covers.
document.getElementById("hero-art").innerHTML = [...finished].sort((a, b) => b.worth.score - a.worth.score).slice(0, 16)
  .map((g) => `<img alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" />`).join("");
function renderStats() {
  document.getElementById("stats").innerHTML = [
    `<b>${finished.length.toLocaleString("en")}</b> patient games`,
    `<b>${finished.filter((g) => g.hours != null && g.hours <= 10).length.toLocaleString("en")}</b> done in 10 hours`,
    `updated <b>${data.updated}</b>`,
  ].map((s) => `<span>${s}</span>`).join("");
}

// Genre list: every tag, most common first.
const tagCount = new Map();
for (const g of finished) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
for (const [t, n] of [...tagCount].sort((a, b) => b[1] - a[1])) form.genre.add(new Option(`${t} (${n})`, t));
// Year list: every release year, newest first.
const yearCount = new Map();
for (const g of finished) yearCount.set(g.released.slice(0, 4), (yearCount.get(g.released.slice(0, 4)) ?? 0) + 1);
for (const [y, n] of [...yearCount].sort((a, b) => b[0] - a[0])) form.year.add(new Option(`${y} (${n})`, y));

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;
// A hash value with no matching chip (e.g. an old link) leaves its group empty; fall back to the first chip.
for (const g of document.querySelectorAll(".group, #rank-tabs")) if (!g.querySelector(":checked")) g.querySelector("input").checked = true;

// Ties fall back to "Worth the wait", so equally family-friendly games still rank by quality.
const sortKey = {
  worth: (g) => g.worth.score,
  dad: (g) => g.dad.score * 1000 + g.worth.score,
};

const fill = (v) => `<span class="bar"><i class="${v >= 70 ? "hi" : v >= 40 ? "ok" : ""}" style="width:${v ?? 0}%"></i></span>`;
// A part may list the sources behind it ([source, 0–100 or null, basis]); each
// gets a small bar of its own, a source that doesn't count is dimmed.
function bar(label, s, none, cls = "", extra = "") {
  if (!s) return `<div class="score none ${cls}"><span>${label}</span><span>${none}</span></div>`;
  const { score, parts } = s;
  const rows = Object.entries(parts)
    .map(([k, [v, why, sources = []]]) => `<li class="${v ? "" : "zero"}"><span>${k} <small>${esc(why)}</small></span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`
      + sources.map(([src, sv, basis]) => `<li class="src ${sv == null ? "zero" : ""}"><span>${src}</span>${fill(sv)}<b>${sv == null ? "–" : Math.round(sv)}</b><small>${esc(basis)}</small></li>`).join(""))
    .join("");
  return `<details class="score ${cls}"><summary><span>${label}</span>${fill(score)}<b>${score}</b></summary><ul>${rows}</ul>${extra}</details>`;
}

// The patient gamer's numbers, big, each with where it comes from: how good it
// is now (players, critics), whether it got better since launch, how long it
// takes, and what it costs on Steam right now (filled in live, see showPrices).
function kpis(g) {
  const tile = (label, value, sub, src, cls = "") => `<div class="kpi ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small><em>${src}</em></div>`;
  const recent = g.recentReviews >= 50;
  const pct = recent ? g.recentPct : g.steamPct, n = recent ? g.recentReviews : g.steamReviews;
  const trend = launchTrend(g);
  const mc = metascore(g), mcUrl = g.mcUrl ?? g.metacriticUrl;
  return `<div class="kpis">
    ${tile("Steam reviews", `${pct}%`, `${fmtN(n)} ${recent ? "in 6 months" : "all time"}`, "Steam", pct >= 90 ? "good" : pct < 75 ? "bad" : "")}
    ${trend == null
      ? tile("Since launch", "–", g.launchPct == null ? "no data yet" : "too new", "Steam reviews")
      : tile("Since launch", `${trend > 0 ? "+" : ""}${trend}`, `${g.launchPct}% → ${g.recentPct}%`, "Steam reviews", trend >= 3 ? "good" : trend <= -5 ? "bad" : "")}
    ${tile("Critics", mc ?? "–", mc == null ? "no Metascore" : g.mcCritics ? `${g.mcCritics} critics` : "Metascore",
      mcUrl ? `<a href="${esc(mcUrl)}">Metacritic</a>` : "Metacritic", mc >= 85 ? "good" : mc != null && mc < 70 ? "bad" : "")}
    ${tile("Main story", g.hours == null ? "–" : `${g.hours}h`, g.hours == null ? "no time yet" : g.hours <= 10 ? "an evening or two" : g.hours <= 25 ? "a few weeks" : "a long one",
      g.hltbId ? `<a href="https://howlongtobeat.com/game/${g.hltbId}">HowLongToBeat</a>` : "HowLongToBeat", g.hours != null && g.hours <= 10 ? "good" : "")}
    ${g.regularPrice
      ? `<div class="kpi price"><span>Steam now</span><b>$${g.regularPrice}</b><small>checking stores…</small><em>Steam via CheapShark</em></div>`
      : tile("Price", "Free", "free to play", "Steam")}
  </div>`;
}

// Live prices: CheapShark lists every official store's current price for a
// Steam game, Steam included. A card asks once it scrolls into view, one
// request at a time, so a long list doesn't trip CheapShark's rate limit. Key
// sellers aren't in CheapShark; the card links to GG.deals, which compares them.
const STORES = { 1: "Steam", 2: "GamersGate", 3: "Green Man Gaming", 7: "GOG", 11: "Humble", 13: "Ubisoft", 15: "Fanatical",
  21: "WinGameStore", 23: "GameBillet", 25: "Epic", 27: "Gamesplanet", 28: "Gamesload", 30: "IndieGala", 35: "DreamGame" };
const dealsCache = new Map();
let queue = Promise.resolve();
function deals(appid) {
  if (!dealsCache.has(appid)) {
    const p = (queue = queue.then(() => new Promise((r) => setTimeout(r, 300)))
      .then(() => fetch(`https://www.cheapshark.com/api/1.0/deals?steamAppID=${appid}`))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null));
    dealsCache.set(appid, p);
    p.then((d) => d || dealsCache.delete(appid)); // a miss is asked again next time
  }
  return dealsCache.get(appid);
}
async function showPrices(li) {
  const d = await deals(li.dataset.appid);
  if (!li.isConnected) return;
  const tile = li.querySelector(".kpi.price"), line = li.querySelector(".deals");
  // null: CheapShark didn't answer (often its rate limit); []: no store sells it.
  if (!d) { tile.querySelector("small").textContent = "list price · live prices unavailable"; return; }
  if (!d.length) { tile.querySelector("small").textContent = "list price"; return; }
  const steam = d.find((x) => x.storeID === "1");
  if (steam) {
    const off = Math.round(Number(steam.savings));
    tile.querySelector("b").textContent = `$${steam.salePrice}`;
    tile.querySelector("small").textContent = off ? `−${off}% of $${steam.normalPrice}` : "full price";
    tile.classList.toggle("good", off >= 50);
  } else tile.querySelector("small").textContent = "list price";
  // Steam wins a tie: no reason to send anyone elsewhere for the same price.
  const best = d.reduce((a, x) => (Number(x.salePrice) < Number(a.salePrice) ? x : a), steam ?? d[0]);
  line.insertAdjacentHTML("afterbegin", `Best price now: <a href="https://www.cheapshark.com/redirect?dealID=${esc(best.dealID)}">$${esc(best.salePrice)} at ${STORES[best.storeID] ?? "another store"} ↗</a> · `);
}
const onScreen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { onScreen.unobserve(e.target); showPrices(e.target); }
}, { rootMargin: "300px" });

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function render() {
  const f = Object.fromEntries(new FormData(form));
  history.replaceState(null, "", "#" + new URLSearchParams(f));

  form.genre.classList.toggle("set", !!f.genre);
  form.year.classList.toggle("set", !!f.year);
  const q = f.q.trim().toLowerCase();
  const pool = f.ea ? games : finished;
  const shown = pool
    .filter((g) => (!q || g.title.toLowerCase().includes(q))
      && (!f.mp || (f.mp === "online" ? !!g.mp : g.mp?.score >= 50))
      && (!f.genre || g.tags?.includes(f.genre))
      && (!f.age || (f.age === "classic" ? g.age >= 120 : g.age <= Number(f.age)))
      && (!f.year || g.released.startsWith(f.year))
      && (!f.reviews || (f.reviews === "gems" ? g.steamReviews < 1e4 : g.steamReviews >= Number(f.reviews)))
      && (!f.mine || (f.mine === "open") !== owns(g.appid))
      && (f.price === "" || g.regularPrice <= Number(f.price))
      && (f.hours === "" || (g.hours != null && g.hours <= Number(f.hours))))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  renderStats();
  const eaRule = document.getElementById("ea-rule");
  eaRule.classList.toggle("on", !!f.ea);
  eaRule.textContent = f.ea ? "Incl. Early Access 1+ yr" : "No Early Access";
  // The rules themselves are the pills next to the count; say what they leave out.
  const left = data.games.length - pool.length;
  count.innerHTML = `<b>${shown.length}</b>${shown.length < pool.length ? ` of ${pool.length}` : ""} patient games`
    + (left ? `<small>${left} newer or unfinished games are left out</small>` : "");
  more.hidden = shown.length <= limit;
  list.innerHTML = shown.slice(0, limit).map((g) => `
    <li class="${owns(g.appid) ? "owned" : ""}"${g.regularPrice ? ` data-appid="${g.appid}"` : ""}>
      <div class="cover">
        <a href="https://store.steampowered.com/app/${g.appid}/">
          <picture>
            <source media="(min-width: 561px)" srcset="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/library_600x900.jpg" />
            <img loading="lazy" alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" onerror="this.previousElementSibling?.remove()" />
          </picture>
        </a>
      </div>
      <div>
        <div class="title-row">
          <h2><a href="https://store.steampowered.com/app/${g.appid}/">${esc(g.title)}</a></h2>
          <button type="button" class="own" data-appid="${g.appid}" data-own="${owns(g.appid)}">${ownLabel(owns(g.appid))}</button>
        </div>
        <p class="meta">${g.released.slice(0, 4)}${g.earlyAccess ? `<span class="ea" title="In Early Access since ${g.released.slice(0, 4)}: not finished yet">Early Access</span>` : ""}${(g.tags ?? []).map((t) =>
          `<button type="button" class="tag${t === f.genre ? " on" : ""}" data-genre="${esc(t)}" title="Show only ${esc(t.trim())} games">${esc(t.trim())}</button>`).join("")}</p>
        ${g.description ? `<p class="desc" title="${esc(g.description)}">${esc(g.description)}</p>` : ""}
        ${kpis(g)}
        ${g.regularPrice ? `<p class="deals">Key sellers: <a href="https://gg.deals/steam/app/${g.appid}/">compare on GG.deals ↗</a></p>` : ""}
        ${bar("Worth the wait", g.worth, "", "primary")}
        ${bar("Gamer Dad", g.dad, "", "primary")}
        ${f.mp && g.mp ? bar("Multiplayer", g.mp) : ""}
      </div>
    </li>`).join("");
  onScreen.disconnect();
  for (const li of list.querySelectorAll("li[data-appid]")) onScreen.observe(li);
}

form.addEventListener("input", (e) => {
  // A release year and a range chip are one choice: picking one clears the other.
  // (Setting form.age.value = "" doesn't select the "Any" radio, hence the query.)
  if (e.target.name === "year" && e.target.value) form.querySelector('input[name="age"][value=""]').checked = true;
  if (e.target.name === "age") form.year.value = "";
  limit = PAGE;
  render();
});
// The rank tabs sit outside the form (form="filters"), so their events don't bubble to it.
document.getElementById("rank-tabs").addEventListener("input", () => { limit = PAGE; render(); });
// "reset" fires before the fields are reset, so render on the next tick.
form.addEventListener("reset", () => setTimeout(() => { limit = PAGE; render(); }));
// The own button toggles. It updates its card in place: re-filtering right
// away would pull the card out from under the cursor ("Not owned" view), so
// the filter applies on its next change.
list.addEventListener("click", (e) => {
  const btn = e.target.closest("button.own");
  if (!btn) return;
  const { appid } = btn.dataset;
  if (owns(appid)) delete mine[appid];
  else mine[appid] = "own";
  saveMine();
  btn.dataset.own = owns(appid);
  btn.textContent = ownLabel(owns(appid));
  btn.closest("li").classList.toggle("owned", owns(appid));
  renderOwnedCount();
});
// A genre pill filters by that genre; clicking the active one clears it.
list.addEventListener("click", (e) => {
  const pill = e.target.closest("[data-genre]");
  if (!pill) return;
  form.genre.value = form.genre.value === pill.dataset.genre ? "" : pill.dataset.genre;
  limit = PAGE;
  render();
  count.scrollIntoView({ block: "start", behavior: "smooth" });
});
more.addEventListener("click", () => { limit += PAGE; render(); });
renderOwnedCount();
render();

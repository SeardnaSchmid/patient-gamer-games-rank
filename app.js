import { worthScore, dadScore, multiplayerScore, isPatient, launchTrend, metascore, fmtN } from "./score.js";

const form = document.getElementById("filters");
const list = document.getElementById("list");
const count = document.getElementById("count");
const more = document.getElementById("more");
const PAGE = 100;
let limit = PAGE;

// My games: a status per game, kept in this browser only.
const STATUS_KEY = "pgr.status.v1";
const STATUSES = { own: ["✓", "Owned"] };
let mine = {};
try { mine = JSON.parse(localStorage.getItem(STATUS_KEY)) ?? {}; } catch {}
const saveMine = () => { try { localStorage.setItem(STATUS_KEY, JSON.stringify(mine)); } catch {} };

const data = await (await fetch("games.json")).json();
document.getElementById("updated").textContent = data.updated;

const games = data.games.map((g) => ({ ...g, patient: isPatient(g), worth: worthScore(g), dad: dadScore(g), mp: multiplayerScore(g) }));

// Banner: covers of the 16 best "Worth the wait" patient games, and what the data covers.
document.getElementById("hero-art").innerHTML = games.filter((g) => g.patient).sort((a, b) => b.worth.score - a.worth.score).slice(0, 16)
  .map((g) => `<img alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" />`).join("");
function renderStats() {
  document.getElementById("stats").innerHTML = [
    `<b>${games.filter((g) => g.patient).length.toLocaleString("en")}</b> patient games`,
    `<b>${games.filter((g) => g.patient && g.hours != null && g.hours <= 10).length.toLocaleString("en")}</b> done in 10 hours`,
    `updated <b>${data.updated}</b>`,
  ].map((s) => `<span>${s}</span>`).join("");
}

// Genre list: every tag, most common first.
const tagCount = new Map();
for (const g of games) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
for (const [t, n] of [...tagCount].sort((a, b) => b[1] - a[1])) form.genre.add(new Option(`${t} (${n})`, t));

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;
// A hash value with no matching chip (e.g. an old link) leaves its group empty; fall back to the first chip.
for (const g of document.querySelectorAll(".group, #rank-tabs")) if (!g.querySelector(":checked")) g.querySelector("input").checked = true;

// Ties fall back to "Worth the wait", so equally family-friendly games still rank by quality.
const sortKey = {
  worth: (g) => g.worth.score,
  dad: (g) => g.dad.score * 1000 + g.worth.score,
  mp: (g) => g.mp.score,
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
// takes, and what it costs (no price tracking here: the link compares stores).
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
    ${tile("Price", g.regularPrice ? `$${g.regularPrice}` : "Free", g.regularPrice ? `<a href="https://isthereanydeal.com/steam/app/${g.appid}/">best price today ↗</a>` : "free to play", "Steam list price")}
  </div>`;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function render() {
  const f = Object.fromEntries(new FormData(form));
  history.replaceState(null, "", "#" + new URLSearchParams(f));

  form.genre.classList.toggle("set", !!f.genre);
  const q = f.q.trim().toLowerCase();
  const shown = games
    .filter((g) => (f.sort !== "mp" || g.mp) // the multiplayer ranking lists online games only
      && (!q || g.title.toLowerCase().includes(q))
      && (!f.genre || g.tags?.includes(f.genre))
      && (!f.reviews || (f.reviews === "gems" ? g.steamReviews < 1e4 : g.steamReviews >= Number(f.reviews)))
      && (f.show === "all" || g.patient)
      && (!f.mine || (f.mine === "open" ? mine[g.appid] !== "own" : mine[g.appid] === f.mine))
      && (f.price === "" || g.regularPrice <= Number(f.price))
      && (f.hours === "" || (g.hours != null && g.hours <= Number(f.hours))))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  renderStats();
  count.textContent = f.show === "all" ? `${shown.length} of ${games.length} games` : `${shown.length} patient games`;
  more.hidden = shown.length <= limit;
  list.innerHTML = shown.slice(0, limit).map((g) => `
    <li>
      <div class="cover">
        <a href="https://store.steampowered.com/app/${g.appid}/">
          <picture>
            <source media="(min-width: 561px)" srcset="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/library_600x900.jpg" />
            <img loading="lazy" alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" onerror="this.previousElementSibling?.remove()" />
          </picture>
        </a>
        <div class="mine" data-appid="${g.appid}">${Object.entries(STATUSES).map(([k, [icon, label]]) =>
          `<button type="button" data-status="${k}" aria-pressed="${mine[g.appid] === k}" title="${label}" aria-label="${label}">${icon}</button>`).join("")}</div>
      </div>
      <div>
        <h2><a href="https://store.steampowered.com/app/${g.appid}/">${esc(g.title)}</a></h2>
        <p class="meta">${[
          g.released.slice(0, 4),
          g.earlyAccess && "Early Access",
          g.liveService && "Live service",
        ].filter(Boolean).join(" · ")}</p>
        ${g.description ? `<p class="desc" title="${esc(g.description)}">${esc(g.description)}</p>` : ""}
        ${kpis(g)}
        ${bar("Worth the wait", g.worth, "", "primary")}
        ${bar("Gamer Dad", g.dad, "", "primary")}
        ${f.sort === "mp" ? bar("Multiplayer", g.mp) : ""}
      </div>
    </li>`).join("");
}

form.addEventListener("input", () => { limit = PAGE; render(); });
// The rank tabs sit outside the form (form="filters"), so their events don't bubble to it.
document.getElementById("rank-tabs").addEventListener("input", () => { limit = PAGE; render(); });
// "reset" fires before the fields are reset, so render on the next tick.
form.addEventListener("reset", () => setTimeout(() => { limit = PAGE; render(); }));
// Status buttons toggle: clicking the active one clears it.
list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-status]");
  if (!btn) return;
  const appid = btn.closest("[data-appid]").dataset.appid;
  if (mine[appid] === btn.dataset.status) delete mine[appid];
  else mine[appid] = btn.dataset.status;
  saveMine();
  render();
});
more.addEventListener("click", () => { limit += PAGE; render(); });
render();

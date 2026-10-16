import { worthScore, dealScore, dadScore, multiplayerScore, typicalPrice, isPatient, launchTrend, fmtN } from "./score.js";

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
// Optional: the price history carried through the data releases.
const priceHistory = await fetch("history.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
document.getElementById("updated").textContent = data.updated;
const end = Date.parse(data.updated) + 864e5;

// The game's tracked prices as [time ms, price], oldest first.
function pricePoints(appid) {
  const rows = priceHistory?.games[appid] ?? [];
  const day = priceHistory?.fields.indexOf("day"), price = priceHistory?.fields.indexOf("price");
  return rows.map((r) => [Date.parse(r[day]), r[price]]).filter(([, p]) => p != null);
}

const games = data.games.map((g) => {
  const pts = pricePoints(g.appid);
  g = { ...g, pts, typical: typicalPrice(pts, end) };
  return { ...g, patient: isPatient(g), worth: worthScore(g), deal: dealScore(g), dad: dadScore(g), mp: multiplayerScore(g) };
});

// Banner: covers of the 16 best "Worth the wait" patient games, and what the data covers.
document.getElementById("hero-art").innerHTML = games.filter((g) => g.patient).sort((a, b) => b.worth.score - a.worth.score).slice(0, 16)
  .map((g) => `<img alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" />`).join("");
const atLow = (g) => g.price > 0 && g.lowest != null && g.price <= g.lowest;
function renderStats() {
  document.getElementById("stats").innerHTML = [
    `<b>${games.filter((g) => g.patient).length.toLocaleString("en")}</b> patient games`,
    `<b>${games.filter(atLow).length.toLocaleString("en")}</b> at their all-time low`,
    `updated <b>${data.updated}</b>`,
  ].filter(Boolean).map((s) => `<span>${s}</span>`).join("");
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

// Ties fall back to "Worth the wait", so equally cheap games still rank by quality.
const sortKey = {
  worth: (g) => g.worth.score,
  deal: (g) => (g.deal?.score ?? -1) * 1000 + g.worth.score, // free games last
  dad: (g) => g.dad.score,
  mp: (g) => g.mp.score,
};

function bar(label, s, none, cls = "") {
  if (!s) return `<div class="score none ${cls}"><span>${label}</span><span>${none}</span></div>`;
  const { score, parts } = s;
  const rows = Object.entries(parts)
    .map(([k, [v, why]]) => `<li class="${v ? "" : "zero"}"><span>${k} <small>${esc(why)}</small></span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`)
    .join("");
  return `<details class="score ${cls}"><summary><span>${label}</span><span class="bar"><i class="${score >= 70 ? "hi" : score >= 40 ? "ok" : ""}" style="width:${score}%"></i></span><b>${score}</b></summary><ul>${rows}</ul></details>`;
}

// Step chart of the price since tracking began, extended to the data's date.
// Baseline is $0 so a drop reads at its true size; the dashed line is the
// all-time low from CheapShark. Each step has a native tooltip.
function priceChart(g) {
  const pts = g.pts;
  const top = Math.max(...pts.map(([, p]) => p), g.lowest ?? 0);
  if (pts.length < 2 || !top) return ""; // nothing to show for an always-free game
  const W = 300, H = 40, t0 = pts[0][0], t1 = Math.max(end, pts.at(-1)[0] + 864e5);
  const x = (t) => ((t - t0) / (t1 - t0)) * W, y = (p) => H - 2 - (p / top) * (H - 4);
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  let d = `M0 ${y(pts[0][1])}`, hits = "";
  pts.forEach(([t, p], i) => {
    const end = i + 1 < pts.length ? pts[i + 1][0] : t1;
    d += `H${x(end)}` + (i + 1 < pts.length ? `V${y(pts[i + 1][1])}` : "");
    hits += `<rect x="${x(t)}" width="${Math.max(x(end) - x(t), 1)}" height="${H}"><title>$${p} from ${fmt(t)}</title></rect>`;
  });
  const low = g.lowest != null ? `<line class="low" x1="0" x2="${W}" y1="${y(g.lowest)}" y2="${y(g.lowest)}" />` : "";
  return `<figure class="price-chart">
    <figcaption><span>Price since ${fmt(t0)}${g.typical ? ` · usually $${g.typical}` : ""}</span><span>high $${Math.max(...pts.map(([, p]) => p))} · ${g.lowest != null ? `<span class="lowkey">low $${g.lowest}</span>` : ""}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price history: ${pts.map(([t, p]) => `$${p} from ${fmt(t)}`).join(", ")}">${low}<path d="${d}" />${hits}</svg>
  </figure>`;
}

// The patient gamer's four numbers, big: how good it is now, whether it got
// better since launch, what it costs, and how far that is from its best price.
function kpis(g) {
  const tile = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const recent = g.recentReviews >= 50;
  const pct = recent ? g.recentPct : g.steamPct, n = recent ? g.recentReviews : g.steamReviews;
  const trend = launchTrend(g);
  const off = g.regularPrice > g.price ? Math.round((1 - g.price / g.regularPrice) * 100) : 0;
  return `<div class="kpis">
    ${tile("Reviews now", `${pct}%`, `${fmtN(n)} ${recent ? "in 6 months" : "all time"}`, pct >= 90 ? "good" : pct < 75 ? "bad" : "")}
    ${trend == null
      ? tile("Since launch", "–", g.launchPct == null ? "no data yet" : "too new")
      : tile("Since launch", `${trend > 0 ? "+" : ""}${trend}`, `${g.launchPct}% → ${g.recentPct}%`, trend >= 3 ? "good" : trend <= -5 ? "bad" : "")}
    ${tile("Price", g.price ? `$${g.price}` : "Free", off >= 5 ? `−${off}% of $${g.regularPrice}` : g.price ? "full price" : "free to play", off >= 50 ? "good" : "")}
    ${g.lowest == null || !g.price
      ? tile("All-time low", "–", "unknown")
      : g.price <= g.lowest
        ? tile("All-time low", "At low", `$${g.lowest}`, "good")
        : tile("All-time low", `+$${(g.price - g.lowest).toFixed(2)}`, `low $${g.lowest}`)}
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
      && (!f.deal || (f.deal === "sale" ? g.regularPrice > g.price * 1.05 : g.price > 0 && g.lowest != null && g.price <= g.lowest))
      && (f.show === "all" || g.patient)
      && (!f.mine || (f.mine === "open" ? mine[g.appid] !== "own" : mine[g.appid] === f.mine))
      && (f.price === "" || g.price <= Number(f.price))
      && (f.hours === "" || (g.hours != null && g.hours <= Number(f.hours))))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  renderStats();
  count.textContent = f.show === "all" ? `${shown.length} of ${games.length} games` : `${shown.length} patient games`;
  more.hidden = shown.length <= limit;
  list.innerHTML = shown.slice(0, limit).map((g) => `
    <li>
      <div class="cover">
        <a href="https://store.steampowered.com/app/${g.appid}/">
          <img loading="lazy" alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" />
        </a>
        <div class="mine" data-appid="${g.appid}">${Object.entries(STATUSES).map(([k, [icon, label]]) =>
          `<button type="button" data-status="${k}" aria-pressed="${mine[g.appid] === k}" title="${label}" aria-label="${label}">${icon}</button>`).join("")}</div>
      </div>
      <div>
        <h2><a href="https://store.steampowered.com/app/${g.appid}/">${esc(g.title)}</a></h2>
        <p class="meta">${[
          g.released.slice(0, 4),
          g.hltbId ? `<a href="https://howlongtobeat.com/game/${g.hltbId}">${g.hours}h</a>` : null,
          g.metacriticUrl ? `<a href="${esc(g.metacriticUrl)}">Metascore ${g.metascore}</a>` : null,
          g.earlyAccess && "Early Access",
          g.liveService && "Live service",
        ].filter(Boolean).join(" · ")}</p>
        ${kpis(g)}
        ${bar("Worth the wait", g.worth, "", "primary")}
        ${bar("Buy now", g.deal, "free to play", "primary")}
        ${priceChart(g)}
        ${f.sort === "dad" ? bar("Gamer Dad", g.dad) : f.sort === "mp" ? bar("Multiplayer", g.mp) : ""}
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

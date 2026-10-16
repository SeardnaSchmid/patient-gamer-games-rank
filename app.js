import { worthScore, dealScore, dadScore, multiplayerScore, typicalPrice, isOnline } from "./score.js";

const form = document.getElementById("filters");
const list = document.getElementById("list");
const count = document.getElementById("count");
const more = document.getElementById("more");
const PAGE = 100;
let limit = PAGE;

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
  return { ...g, worth: worthScore(g), deal: dealScore(g), dad: dadScore(g), mp: multiplayerScore(g) };
});

// Genre list: every tag, most common first.
const tagCount = new Map();
for (const g of games) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
for (const [t, n] of [...tagCount].sort((a, b) => b[1] - a[1])) form.genre.add(new Option(`${t} (${n})`, t));

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;
// A hash value with no matching chip (e.g. an old link) leaves its group empty; fall back to the first chip.
for (const g of form.querySelectorAll(".group")) if (!g.querySelector(":checked")) g.querySelector("input").checked = true;

// Ties fall back to "Worth it", so equally cheap games still rank by quality.
const sortKey = {
  worth: (g) => g.worth.score,
  deal: (g) => (g.deal?.score ?? -1) * 1000 + g.worth.score, // free games last
  dad: (g) => g.dad.score,
  mp: (g) => g.mp.score,
};

function bar(label, s, none) {
  if (!s) return `<div class="score none"><span>${label}</span><span>${none}</span></div>`;
  const { score, parts } = s;
  const rows = Object.entries(parts)
    .map(([k, [v, why]]) => `<li class="${v ? "" : "zero"}"><span>${k} <small>${esc(why)}</small></span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`)
    .join("");
  return `<details class="score"><summary><span>${label}</span><span class="bar"><i class="${score >= 70 ? "hi" : score >= 40 ? "ok" : ""}" style="width:${score}%"></i></span><b>${score}</b></summary><ul>${rows}</ul></details>`;
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

function priceChip(g) {
  if (!g.price) return "Free";
  const off = g.regularPrice > g.price ? Math.round((1 - g.price / g.regularPrice) * 100) : 0;
  const low = g.lowest == null ? "" : g.price > g.lowest ? ` · low $${g.lowest}` : " · all-time low";
  return `$${g.price}${off >= 5 ? ` −${off}%` : ""}${low}`;
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
      && (!f.deck || g.deck === "verified" || (f.deck === "playable" && g.deck === "playable"))
      && (f.price === "" || g.price <= Number(f.price))
      && (f.hours === "" || (g.hours != null && g.hours <= Number(f.hours))))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  count.textContent = `${shown.length} of ${games.length} games`;
  more.hidden = shown.length <= limit;
  list.innerHTML = shown.slice(0, limit).map((g) => `
    <li>
      <a class="cover" href="https://store.steampowered.com/app/${g.appid}/">
        <img loading="lazy" alt="" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" />
      </a>
      <div>
        <h2><a href="https://store.steampowered.com/app/${g.appid}/">${esc(g.title)}</a></h2>
        <ul class="chips">
          <li>${g.released.slice(0, 4)}</li>
          <li class="${g.price && g.lowest != null && g.price <= g.lowest ? "good" : ""}">${priceChip(g)}</li>
          <li>${g.hltbId ? `<a href="https://howlongtobeat.com/game/${g.hltbId}">${g.hours}h</a>` : "? h"}</li>
          ${g.metacriticUrl ? `<li><a href="${esc(g.metacriticUrl)}">Metascore ${g.metascore}</a></li>` : ""}
          <li>Steam ${g.steamPct}%</li>
          ${g.earlyAccess ? `<li class="warn">Early Access</li>` : ""}
          ${isOnline(g) ? `<li>${g.singleplayer === false ? "Online only: " : ""}${[g.onlineCoop && "Online co-op", g.onlinePvp && "PvP", g.mmo && "MMO"].filter(Boolean).join(" · ")}</li>` : ""}
          <li class="${g.deck === "verified" ? "good" : ""}">Deck ${g.deck}</li>
          ${(g.tags ?? []).map((t) => `<li class="tag"><button type="button" data-tag="${esc(t)}">${esc(t)}</button></li>`).join("")}
        </ul>
        ${priceChart(g)}
        ${bar("Worth it", g.worth)}
        ${bar("Buy now", g.deal, "free to play")}
        ${bar("Gamer Dad", g.dad)}
        ${g.mp ? bar("Multiplayer", g.mp) : ""}
      </div>
    </li>`).join("");
}

form.addEventListener("input", () => { limit = PAGE; render(); });
// Clicking a tag on a card filters by it.
list.addEventListener("click", (e) => {
  const tag = e.target.closest("[data-tag]")?.dataset.tag;
  if (!tag) return;
  form.genre.value = tag;
  limit = PAGE;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
more.addEventListener("click", () => { limit += PAGE; render(); });
render();

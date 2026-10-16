import { patientScore, dadScore } from "./score.js";

const form = document.getElementById("filters");
const list = document.getElementById("list");
const count = document.getElementById("count");
const more = document.getElementById("more");
const PAGE = 100;
let limit = PAGE;

const data = await (await fetch("games.json")).json();
document.getElementById("updated").textContent = data.updated;
const games = data.games.map((g) => ({
  ...g,
  patient: patientScore(g),
  dad: dadScore(g),
}));

// Genre list: every tag, most common first.
const tagCount = new Map();
for (const g of games) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
for (const [t, n] of [...tagCount].sort((a, b) => b[1] - a[1])) form.genre.add(new Option(`${t} (${n})`, t));

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;
// A hash value with no matching chip (e.g. an old link) leaves its group empty; fall back to the first chip.
for (const g of form.querySelectorAll(".group")) if (!g.querySelector(":checked")) g.querySelector("input").checked = true;

const sortKey = { patient: (g) => g.patient.score, dad: (g) => g.dad.score, both: (g) => g.patient.score + g.dad.score };

function bar(label, { score, parts }) {
  const rows = Object.entries(parts)
    .map(([k, [v, why]]) => `<li class="${v ? "" : "zero"}"><span>${k} <small>${esc(why)}</small></span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`)
    .join("");
  return `<details class="score"><summary><span>${label}</span><span class="bar"><i class="${score >= 70 ? "hi" : score >= 40 ? "ok" : ""}" style="width:${score}%"></i></span><b>${score}</b></summary><ul>${rows}</ul></details>`;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function render() {
  const f = Object.fromEntries(new FormData(form));
  history.replaceState(null, "", "#" + new URLSearchParams(f));

  form.genre.classList.toggle("set", !!f.genre);
  const q = f.q.trim().toLowerCase();
  const shown = games
    .filter((g) => (!q || g.title.toLowerCase().includes(q))
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
          <li class="${g.price && g.price <= g.lowest ? "good" : ""}">${g.price ? `$${g.price}` : "Free"}${g.price > g.lowest ? ` · low $${g.lowest}` : g.price ? " · all-time low" : ""}</li>
          <li>${g.hltbId ? `<a href="https://howlongtobeat.com/game/${g.hltbId}">${g.hours}h</a>` : "? h"}</li>
          ${g.metacriticUrl ? `<li><a href="${esc(g.metacriticUrl)}">Metascore ${g.metascore}</a></li>` : ""}
          <li>Steam ${g.steamPct}%</li>
          <li class="${g.deck === "verified" ? "good" : ""}">Deck ${g.deck}</li>
          ${(g.tags ?? []).map((t) => `<li class="tag"><button type="button" data-tag="${esc(t)}">${esc(t)}</button></li>`).join("")}
        </ul>
        ${bar("Patient Gamer", g.patient)}
        ${bar("Gamer Dad", g.dad)}
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

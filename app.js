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

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;

const sortKey = { patient: (g) => g.patient.score, dad: (g) => g.dad.score, both: (g) => g.patient.score + g.dad.score };

function bar(label, { score, parts }) {
  const rows = Object.entries(parts)
    .map(([k, [v, why]]) => `<li class="${v ? "" : "zero"}"><span>${k} <small>${esc(why)}</small></span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`)
    .join("");
  return `<details class="score"><summary><span>${label}</span><meter min="0" max="100" low="40" high="70" optimum="100" value="${score}"></meter><b>${score}</b></summary><ul>${rows}</ul></details>`;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function render() {
  const f = Object.fromEntries(new FormData(form));
  form.priceOut.value = f.price == 70 ? "any" : `$${f.price}`;
  form.hoursOut.value = f.hours == 100 ? "any" : `${f.hours}h`;
  history.replaceState(null, "", "#" + new URLSearchParams(f));

  const q = f.q.trim().toLowerCase();
  const shown = games
    .filter((g) => (!q || g.title.toLowerCase().includes(q))
      && (!f.deck || g.deck === "verified" || (f.deck === "playable" && g.deck === "playable"))
      && (f.price == 70 || g.price <= f.price)
      && (f.hours == 100 || (g.hours != null && g.hours <= f.hours)))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  count.textContent = `${shown.length} of ${games.length} games`;
  more.hidden = shown.length <= limit;
  list.innerHTML = shown.slice(0, limit).map((g) => `
    <li>
      <h2><a href="https://store.steampowered.com/app/${g.appid}/">${esc(g.title)}</a></h2>
      <p class="meta">
        ${g.released.slice(0, 4)}
        · $${g.price}${g.price > g.lowest ? ` (low $${g.lowest})` : g.price ? " (all-time low)" : " (free)"}
        · ${g.hltbId ? `<a href="https://howlongtobeat.com/game/${g.hltbId}">${g.hours}h</a>` : "? h"}
        · ${g.metacriticUrl ? `<a href="${esc(g.metacriticUrl)}">Metascore ${g.metascore}</a>` : "no Metascore"}
        · Steam ${g.steamPct}%
        · Deck ${g.deck}
      </p>
      ${bar("Patient Gamer", g.patient)}
      ${bar("Gamer Dad", g.dad)}
    </li>`).join("");
}

form.addEventListener("input", () => { limit = PAGE; render(); });
more.addEventListener("click", () => { limit += PAGE; render(); });
render();

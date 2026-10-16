import { patientScore, dadScore } from "./score.js";

const form = document.getElementById("filters");
const list = document.getElementById("list");
const count = document.getElementById("count");

const games = (await (await fetch("games.json")).json()).map((g) => ({
  ...g,
  patient: patientScore(g),
  dad: dadScore(g),
}));

for (const p of [...new Set(games.flatMap((g) => g.platforms))].sort()) form.platform.add(new Option(p, p));

// Filters live in the URL hash so a ranking can be shared as a link.
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) if (form[k]) form[k].value = v;

const sortKey = { patient: (g) => g.patient.score, dad: (g) => g.dad.score, both: (g) => g.patient.score + g.dad.score };

function bar(label, { score, parts }) {
  const rows = Object.entries(parts)
    .filter(([, v]) => v)
    .map(([k, v]) => `<li><span>${k}</span><span>${v > 0 ? "+" : ""}${Math.round(v)}</span></li>`)
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
      && (!f.platform || g.platforms.includes(f.platform))
      && (f.price == 70 || g.price <= f.price)
      && (f.hours == 100 || g.hours <= f.hours))
    .sort((a, b) => sortKey[f.sort](b) - sortKey[f.sort](a));

  count.textContent = `${shown.length} of ${games.length} games`;
  list.innerHTML = shown.map((g) => `
    <li>
      <h2>${esc(g.title)}</h2>
      <p class="meta">${g.released.slice(0, 4)} · ${g.platforms.join(", ")} · ~$${g.price} · ${g.hours}h · Metascore ${g.meta}${g.user != null ? ` · User ${g.user}` : ""}</p>
      ${bar("Patient Gamer", g.patient)}
      ${bar("Gamer Dad", g.dad)}
    </li>`).join("");
}

form.addEventListener("input", render);
render();

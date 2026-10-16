// Appends today's values from games.json to history.json, so every data
// release carries the full history. A game gets a new row only when one of the
// tracked values changed; steamReviews rides along but grows daily for big
// games, so it doesn't trigger a row on its own. Run: node scripts/history.mjs
import { readFileSync, writeFileSync } from "node:fs";

export const FIELDS = ["price", "lowest", "steamPct", "metascore", "deck", "steamReviews"];
const TRIGGERS = FIELDS.length - 1; // every field but steamReviews

export function appendHistory(history, games, day) {
  for (const g of games) {
    const row = [day, ...FIELDS.map((f) => g[f] ?? null)];
    const rows = (history.games[g.appid] ??= []);
    const last = rows.at(-1);
    if (last?.[0] === day) rows[rows.length - 1] = row; // rerun on the same day
    else if (!last || row.slice(1, 1 + TRIGGERS).some((v, i) => v !== last[1 + i])) rows.push(row);
  }
  return history;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let history = { fields: ["day", ...FIELDS], games: {} };
  try { history = JSON.parse(readFileSync("history.json")); } catch { console.log("no history.json yet, starting one"); }
  const data = JSON.parse(readFileSync("games.json"));
  appendHistory(history, data.games, data.updated);
  const lines = Object.entries(history.games).map(([id, rows]) => ` "${id}":${JSON.stringify(rows)}`);
  writeFileSync("history.json", `{"fields":${JSON.stringify(history.fields)},"games":{\n${lines.join(",\n")}\n}}\n`);
  console.log(`history: ${lines.length} games, ${Object.values(history.games).reduce((n, r) => n + r.length, 0)} rows`);
}

# Patient Gamers Rank

A static page that ranks games by two scores:

- **Patient Gamer**: is it worth buying now? Rewards age, a low sale price, quality, complete editions, and games that improved after launch.
- **Gamer Dad**: does it fit a busy schedule? Rewards a short main story, quality, short-session play, and handheld support.

You can filter by Steam Deck status, max price and max hours. The filters are stored in the URL hash, so you can share a link to a filtered ranking. Click a score to see how it was calculated.

## Data

Every value a score uses is fetched, not typed in. `scripts/fetch.mjs` takes every Steam game with at least 1,000 reviews and 75 % positive (from [SteamSpy](https://steamspy.com/api.php)) and builds `games.json` from:

| Value | Source |
|---|---|
| Release date, Metascore, controller support, Steam Cloud, "Save Anytime", free-to-play/in-app purchases | Steam store API (`appdetails`) |
| % positive reviews, Steam price | SteamSpy |
| Steam Deck Verified / Playable | Steam Deck compatibility report |
| Best current price across stores, all-time low (USD) | [CheapShark API](https://apidocs.cheapshark.com/) |
| Genre tags (top 4, minus mood tags like "Indie") | SteamSpy |
| Main-story hours | HowLongToBeat (unofficial site API, may break) |

Release date, Metascore, features, Deck rating, tags and playtime are fetched once per game (refreshed after 90 days), at most `LIMIT` (default 300) new games per run, so a fresh catalogue fills up over a few runs. Reviews and prices are refreshed on every run. If a source fails, the game keeps its previous value. The deploy workflow runs the fetch daily and on manual runs. To fetch everything at once, run it manually from the Actions tab with `limit` 7000 (about 3.5 hours; the script stops after 5 hours and saves what it has):

```sh
gh workflow run deploy.yml -f limit=7000
``` The scoring rules are in `score.js`.

## Local development

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node --test score.test.js
LIMIT=50 node scripts/fetch.mjs   # refresh games.json
```

There is no build step and there are no dependencies.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests and publishes the repo root on GitHub Pages. Set **Settings → Pages → Source** to **GitHub Actions** once.

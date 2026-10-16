# Patient Gamers Rank

A static page that ranks games for patient gamers. Two scores answer the patient gamer's two questions, two more are separate lenses:

- **Worth it**: is the game good and finished today? Quality from the last 6 months of Steam reviews, how reviews moved since the launch quarter (was it fixed?), out a year and not Early Access or live service, Metascore.
- **Buy now**: is today the moment? Discount off the list price, distance to the all-time low, and, once 30 days are tracked, whether the price is below what the game usually costs.
- **Gamer Dad**: does it fit a busy schedule? Short main story, quality, Steam Deck, controller, cloud saves, "Save Anytime".
- **Multiplayer** (online games only): is the community still there? Players, review activity now vs. half a year ago, quality, recent developer announcements.

The rules and weights are in `score.js` and on the page under "How the scores work". You can filter by genre, Steam Deck status, max price and max hours. The filters are stored in the URL hash, so you can share a link to a filtered ranking. Click a score to see how it was calculated.

## Data

Every value a score uses is fetched, not typed in. `scripts/fetch.mjs` takes every Steam game with at least 1,000 reviews and 75 % positive (from [SteamSpy](https://steamspy.com/api.php)) and builds `games.json` from:

| Value | Source |
|---|---|
| Release date, Metascore, controller support, Steam Cloud, "Save Anytime", free-to-play/in-app purchases, Early Access, single-player/online co-op/PvP/MMO | Steam store API (`appdetails`) |
| % positive reviews, Steam price and list price, peak players yesterday | SteamSpy |
| % positive at launch and in the last 6 months, review activity (refreshed monthly) | Steam review histogram |
| Date of the last developer announcement (refreshed monthly) | Steam news API |
| Steam Deck Verified / Playable | Steam Deck compatibility report |
| Best current price across stores, all-time low (USD) | [CheapShark API](https://apidocs.cheapshark.com/) |
| Genre tags (top 4, minus mood tags like "Indie") | SteamSpy |
| Main-story hours | HowLongToBeat (unofficial site API, may break) |

A source that fails keeps the game's previous value. The scoring rules are in `score.js`.

### Daily data releases

`games.json` is not in the repo. Every day at 05:00 UTC the workflow downloads the latest data release, fetches every game fresh on top of it (about 3.5 hours; it stops after 5 hours and keeps the rest from the previous day), appends today's values to `history.json`, publishes both as a release named `data-YYYY-MM-DD` and deploys the site with them.

`history.json` carries over from release to release, so every release holds the whole history. Per game it stores one row for every day on which the price, all-time low, Steam %, Metascore or Deck rating changed (with the review count of that day):

```json
{"fields":["day","price","lowest","steamPct","metascore","deck","steamReviews"],"games":{
 "620":[["2026-10-16",9.99,0.99,99,95,"verified",412000]]
}}
``` Pushes deploy the latest release's data without fetching.

To fetch and release outside the daily schedule:

```sh
gh workflow run deploy.yml -f fetch=true
```

## Local development

```sh
gh release download --pattern '*.json' --clobber      # latest data and history
python3 -m http.server 8000                          # then open http://localhost:8000
node --test
LIMIT=50 node scripts/fetch.mjs                      # fetch details for up to 50 games
```

There is no build step and there are no dependencies.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests and publishes the repo root (plus the latest `games.json`) on GitHub Pages. Set **Settings → Pages → Source** to **GitHub Actions** once.

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

A source that fails keeps the game's previous value. The scoring rules are in `score.js`.

### Daily data releases

`games.json` is not in the repo. Every day at 05:00 UTC the workflow downloads the latest data release, fetches every game fresh on top of it (about 3.5 hours; it stops after 5 hours and keeps the rest from the previous day), publishes the result as a release named `data-YYYY-MM-DD` and deploys the site with it. Pushes deploy the latest release's data without fetching.

To fetch and release outside the daily schedule:

```sh
gh workflow run deploy.yml -f fetch=true
```

## Local development

```sh
gh release download --pattern games.json --clobber   # latest data
python3 -m http.server 8000                          # then open http://localhost:8000
node --test score.test.js
LIMIT=50 node scripts/fetch.mjs                      # fetch details for up to 50 games
```

There is no build step and there are no dependencies.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests and publishes the repo root (plus the latest `games.json`) on GitHub Pages. Set **Settings → Pages → Source** to **GitHub Actions** once.

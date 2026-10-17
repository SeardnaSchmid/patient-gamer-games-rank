# Patient Gamers Rank

A static page that ranks patient games: games out for at least a year and finished (not Early Access, not live service), so the hype is over, the patches are in and the price has dropped. Two scores answer the two questions of a patient gamer with little time, and the cards show the numbers behind them (Steam reviews now, change since launch, Metascore, main-story length, list price with a link to today's best offer):

- **Worth the wait**: how good is the game today? 60 % players (Steam reviews of the last 6 months, Metacritic user score, GOG and HowLongToBeat ratings, each with at least 50 votes, averaged with weights by the digits of the vote count: 1,000 votes weigh 3, a million weigh 6), 40 % critics (Metascore); a missing source is left out. Being finished is the patient filter, and how reviews moved since launch (was it fixed?) is shown on the card, not scored.
- **Gamer Dad**: does it fit a busy life? Short main story (HowLongToBeat), quality (Worth the wait), Steam Deck, controller, cloud saves, "Save Anytime", minus live service.

One other lens sits beside them:

- **Multiplayer** (online games only): is the community still there? Players, review activity now vs. half a year ago, quality, recent developer announcements.

The rules and weights are in `score.js` and on the page under "How the scores work". You can filter by genre, number of Steam reviews (10k+ and 100k+ for safe picks, "Hidden gems" for good games under 10k reviews), owned, Steam list price, length, and patient games vs. all games.

**My games**: the ✓ button on a cover marks a game as owned. The marks live in your browser's local storage (`pgr.status.v1`), with no account, and drive the "My games" filter (all, not owned, owned). The filters are stored in the URL hash, so you can share a link to a filtered ranking. Click a score to see how it was calculated.

## Data

Every value a score uses is fetched, not typed in. `scripts/fetch.mjs` takes every Steam game with at least 1,000 reviews and 75 % positive (from [SteamSpy](https://steamspy.com/api.php)) and builds `games.json` from:

| Value | Source |
|---|---|
| Release date, short description, Metascore (fallback), controller support, Steam Cloud, "Save Anytime", free-to-play/in-app purchases, Early Access, single-player/online co-op/PvP/MMO | Steam store API (`appdetails`) |
| % positive reviews, Steam list price, peak players yesterday | SteamSpy |
| % positive at launch and in the last 6 months, review activity (refreshed monthly) | Steam review histogram |
| Date of the last developer announcement (refreshed monthly) | Steam news API |
| Steam Deck Verified / Playable | Steam Deck compatibility report |
| Genre tags (top 4, minus mood tags like "Indie") | SteamSpy |
| Main-story hours, user rating | HowLongToBeat (unofficial site API, may break) |
| Metascore and user score (refreshed monthly) | Metacritic game page (unofficial, may break) |
| User rating (refreshed monthly) | [GOG catalog](https://catalog.gog.com/v1/catalog) |

A source that fails keeps the game's previous value. No source is required: a game that isn't on Metacritic, GOG or HowLongToBeat just scores on the rest. The scoring rules are in `score.js`.

### Weekly data releases

`games.json` is not in the repo. Every Monday at 05:00 UTC the workflow downloads the latest data release, fetches every game fresh on top of it (about 3.5 hours; it stops after 5 hours and keeps the rest from the previous week), publishes it as a release named `data-YYYY-MM-DD` and deploys the site with it. Pushes deploy the latest release's data without fetching.

Prices are not tracked: they change by the day and would need a daily scraper. Cards show Steam's list price and link to [IsThereAnyDeal](https://isthereanydeal.com/) for today's best offer.

To fetch and release outside the weekly schedule:

```sh
gh workflow run deploy.yml -f fetch=true
```

## Local development

```sh
gh release download --pattern games.json --clobber    # latest data
python3 -m http.server 8000                          # then open http://localhost:8000
node --test
LIMIT=50 node scripts/fetch.mjs                      # fetch details for up to 50 games
```

There is no build step and there are no dependencies.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests and publishes the repo root (plus the latest `games.json`) on GitHub Pages. Set **Settings → Pages → Source** to **GitHub Actions** once.

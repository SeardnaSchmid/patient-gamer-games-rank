# Patient Gamers Rank

A static page that ranks games by two scores:

- **Patient Gamer**: is it worth buying now? Rewards age, a low sale price, quality, complete editions, and games that improved after launch.
- **Gamer Dad**: does it fit a busy schedule? Rewards a short main story, quality, short-session play, and handheld support.

You can filter by platform, max price and max hours. The filters are stored in the URL hash, so you can share a link to a filtered ranking. Click a score to see how it was calculated.

## Data

`games.json` is written by hand. Prices are rough sale prices in USD and hours are approximate HowLongToBeat main-story times. To add a game, add one object:

```json
{"title":"…","released":"YYYY-MM","platforms":["PC"],"meta":90,"user":8.5,"price":10,"hours":12,
 "complete":true,"bursts":true,"handheld":true,"liveService":false}
```

The scoring rules are in `score.js`.

## Local development

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node --test score.test.js
```

There is no build step and there are no dependencies.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests and publishes the repo root on GitHub Pages. Set **Settings → Pages → Source** to **GitHub Actions** once.

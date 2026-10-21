# Hand & Brain GeoGrid

A two-player, hand-and-brain version of [GeoGrid](https://www.geogridgame.com/).
The **Brain** picks a country, the **Hand** places it on the 3×3 grid. You get 10 guesses. Each player sees the rows and columns in a different order, so you can't just say "top left".

## Run it

```
python -m http.server 8000
```

Open http://localhost:8000, send the link it shows to your partner (you can test in two tabs).

To host it for real, push the folder to GitHub Pages. There's no build step and no backend.

## How it works

```
index.html        page skeleton
css/style.css     styles
js/game.js        rules: state + applyAction(), no DOM or network
js/net.js         peer-to-peer link (PeerJS / WebRTC)
js/app.js         wiring + rendering
data/             grids and country list (static JSON)
scripts/scrape.py fetches recent GeoGrid boards into data/
```

- **No server of our own.** The two browsers connect directly over WebRTC. PeerJS's free
  public server handles only the initial handshake. Everything else is static files.
- **The host is the referee.** Every action, from either player, runs through
  `applyAction()` in the host's browser. The host then sends the new state to the guest.
- **Validation happens in the browser.** Each board file includes its answers. That's
  fine for a game between friends.

## Data

`python scripts/scrape.py [days]` pulls the last N days of GeoGrid boards and converts them
to our own format (documented at the top of the script). A generated board only needs to
produce the same JSON and get listed in `data/boards/index.json`.

For a grid generator: GeoGrid also publishes per-country attributes at
`https://cdn-assets.teuteuf.fr/data/geogrid/combined.json` (flags, borders, GDP, languages, …).
That's a good starting point for an internal DB. A category becomes a predicate over those
attributes, and a grid is 3 row + 3 column predicates where every cell has enough answers.

## Known limits

- If the host reloads, the game resets and the old link stops working.
- Some strict networks (corporate or symmetric NAT) block a direct WebRTC connection.
  The fix is to add a TURN server to `new Peer(..., { config })` in `net.js`.

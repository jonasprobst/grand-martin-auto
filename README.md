# Grand Martin Auto

A 3D driving game for kids. Pick a car, pick a spot in Bern, and drive around its real streets and hills collecting stars.

**Play it: https://jonasprobst.github.io/grand-martin-auto/**

- Bern only for now, with five starting spots. Each loads about 1 km around it.
- The ground has real hills from swisstopo's terrain service. The ground is levelled along each road, and bridges span the valleys.
- Streets, buildings, parks and water still come from OpenStreetMap, as vector tiles from OpenFreeMap. Moving these to swisstopo data is the next step (see `docs/swisstopo-plan.md`).
- The pause screen shows which map and terrain source loaded, or why terrain failed.
- Works with touch buttons on phones and tablets, and with arrow keys or WASD on a computer.
- No build step: `index.html`, `js/core.js` (map data, geometry, car physics) and `js/game.js` (rendering, sound, game flow). three.js loads from cdnjs.

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

Map tiles: OpenFreeMap © OpenMapTiles. Data from OpenStreetMap. Terrain in Switzerland © swisstopo.

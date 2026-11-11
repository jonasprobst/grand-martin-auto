# Grand Martin Auto

A 3D driving game for kids. Pick a car, pick a spot in Bern, and drive around its real streets and hills collecting stars.

**Play it: https://jonasprobst.github.io/grand-martin-auto/**

- Bern only for now, with five starting spots. Each loads about 1 km around it.
- The ground has real hills from swisstopo's terrain service. The ground is levelled along each road, and bridges span the valleys.
- Streets, footprints, parks and water come from swisstopo's base vector tiles. If those fail, the game falls back to OpenFreeMap (OpenStreetMap data) and says so on the pause screen.
- Houses are swisstopo's swissBUILDINGS3D models with real roof shapes, each set on the game's ground. If the models fail, houses are drawn as simple blocks from the footprints.
- The pause screen shows which map and terrain source loaded, or why terrain failed.
- Works with touch buttons on phones and tablets, and with arrow keys or WASD on a computer.
- No build step: `index.html`, `js/core.js` (map data, geometry, car physics) and `js/game.js` (rendering, sound, game flow). three.js loads from cdnjs, its glTF and Draco loaders from jsDelivr.

Tests: `node test/core.test.js` for the logic, `node test/browser.js` to load every spot with real data in headless Chrome (needs Playwright). See `docs/swisstopo-plan.md`.

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

Streets, houses and terrain © swisstopo. Fallback map tiles: OpenFreeMap © OpenMapTiles, data from OpenStreetMap.

# Grand Martin Auto

A 3D driving game for kids. Pick a car, pick any real place, and drive around its streets collecting stars.

**Play it: https://jonasprobst.github.io/grand-martin-auto/**

- Streets, buildings, parks and water load live from OpenStreetMap, about 1 km around the place you search. The data comes as vector tiles from OpenFreeMap, with the Overpass API as backup.
- Bern is the first city button and the test map.
- In Switzerland the ground has real hills from swisstopo's terrain service. Roads follow the slopes and bridges span the valleys. Elsewhere the city is flat.
- The pause screen shows which map and terrain source loaded, or why terrain failed.
- Works with touch buttons on phones and tablets, and with arrow keys or WASD on a computer.
- No build step: `index.html`, `js/core.js` (map data, geometry, car physics) and `js/game.js` (rendering, sound, game flow). three.js loads from cdnjs.

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

Map tiles: OpenFreeMap © OpenMapTiles. Data from OpenStreetMap. Terrain in Switzerland © swisstopo.

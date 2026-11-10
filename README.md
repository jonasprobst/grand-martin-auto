# Grand Martin Auto

A 3D driving game for kids. Pick a car, pick any real place, and drive around its streets collecting stars.

- Streets, buildings, parks and water load live from OpenStreetMap (Overpass API), about 1 km around the place you search.
- Works with touch buttons on phones and tablets, and with arrow keys or WASD on a computer.
- No build step: `index.html`, `js/core.js` (map data, geometry, car physics) and `js/game.js` (rendering, sound, game flow). three.js loads from cdnjs.

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

Map data © OpenStreetMap contributors.

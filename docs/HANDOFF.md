# Handoff, 11 November 2026

## What exists

A single-page game, live on GitHub Pages. Menu: pick one of six cars, pick one of five starting spots in Bern
(Altstadt, Bärenpark, Bahnhof, Kirchenfeld, Wankdorf) or Practice Town (a made-up grid town that needs no map data).
Each spot loads a square of about 1.1 km. The player drives with touch buttons or keyboard, collects stars placed on
streets, and advances through levels. HUD: minimap, street-name sign, arrow to the nearest star, speedometer, score.

## How a spot loads (`go()` in `js/game.js`)

1. Street map: swisstopo base vector tiles (OpenMapTiles layout), zoom 14. Fallback: OpenFreeMap.
   `C.decodeMVT` and `C.worldFromTiles` turn tiles into roads, building footprints, areas, rivers.
2. Terrain: swisstopo quantized-mesh tiles, zoom 15 then 14. `C.decodeQM`, `C.rasterTIN`, `C.finishTerrain` build a
   10 m height grid. `C.applyTerrain` levels the ground along roads (`burnRoads`) and gives bridges a deck.
3. Houses: swissBUILDINGS3D 3D Tiles. `loadModels` walks `tileset.json`, loads `.b3dm` tiles with GLTFLoader and
   DRACOLoader, converts Earth-centred coordinates to local metres and seats each house on the ground
   (`C.modelToLocal`, `C.seatBuildings`). Fallback: extruded blocks from the footprints (`C.buildBuildings`).
   Trees load at the same time from swisstopo's vegetation tiles (`loadTrees`); fallback: trees scattered in parks.
4. `C.indexWorld` adds lookups (`nearestRoad`, `hitBuilding`, `groundAt`), then `buildWorld` creates the meshes.

Flat layers (roads, parks, water) are cut along the terrain grid by `C.drapeFlat` so they lie exactly on the terrain
mesh. Collision is 2D against the footprints; a car on a road never collides.

## Verified on the owner's phone

- Menu, HUD, touch controls, Practice Town.
- Street map from OpenFreeMap (before the switch to swisstopo tiles).
- swisstopo terrain in Bern: hills, draped roads, car following the ground. Owner: "It's looking good."

## Verified with real data in headless Chrome (11 November 2026)

The workspace now reaches the data servers. `node tests/browser/real_check.js` loads every spot with real data.

- swisstopo street tiles: zoom 14, roads, footprints, parks and water all present. No fallback needed.
- Terrain at zoom 15, road levelling and bridges: look right in screenshots. Bridge decks span the Aare.
- Building models: `tileset.json` is a tree of external tilesets with ADD refinement, about 120 `.b3dm` tiles and
  4 million points per spot, two meshes per tile (roofs, walls), y up, `_BATCHID` survives as a float attribute.
  Loading takes 12 to 30 seconds. House ids are not always whole, positive numbers; that crashed every city once.

## Still not verified

- Speed and memory on the owner's phone with the building models (about 1 million triangles in view in the old town).
  Headless Chrome renders in software at a few frames per second, so it says nothing about a real device.
- The owner has not yet confirmed the bridge fix and road levelling on the phone.

## How to debug with the owner

The owner tests on an Android phone and sends screenshots. The PAUSE screen shows one info line with the source and
details for map, terrain, bridges and houses, or the failure reason. Ask for that screenshot first.
`#terrain-test` at the end of the address plus Practice Town loads Bern's terrain and houses under the practice
streets, which separates terrain and model problems from street-map problems.

## Open questions and next steps

1. Get the owner's screenshots for bridges and for the swisstopo streets and houses; fix what they show.
2. If `tileset.json` proves too large or slow, find the tile grid and request tiles directly, or cache the tile list.
3. Possible later: facade detail on houses, landmarks, more Swiss cities, gravity on slopes, traffic.
   Real trees and bridge piers are done; see step 3 in `docs/swisstopo-plan.md`.

## History in brief

- Started as a worldwide game on OpenStreetMap via Overpass; the public Overpass servers were overloaded, so the map
  moved to OpenFreeMap vector tiles.
- The owner asked for swisstopo models and terrain, then narrowed the scope to Bern and swisstopo data only.
  City search, other cities and Overpass were removed.
- The previous agent could not reach any of the data servers or the three.js CDN from its workspace, so nothing was
  ever rendered there. GitHub Pages also had to be switched on by the owner in the repo settings.

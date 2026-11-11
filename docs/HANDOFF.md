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
4. `C.indexWorld` adds lookups (`nearestRoad`, `hitBuilding`, `groundAt`), then `buildWorld` creates the meshes.

Flat layers (roads, parks, water) are cut along the terrain grid by `C.drapeFlat` so they lie exactly on the terrain
mesh. Collision is 2D against the footprints; a car on a road never collides.

## Verified on the owner's phone

- Menu, HUD, touch controls, Practice Town.
- Street map from OpenFreeMap (before the switch to swisstopo tiles).
- swisstopo terrain in Bern: hills, draped roads, car following the ground. Owner: "It's looking good."

## Not verified (written without network access to the data servers)

All of the following were tested only against synthetic data or mocks. Treat them as likely to need fixes.

- **Bridge fix.** The owner reported that roads dipped into the valley on two bridges, one slightly and one badly.
  A fix was pushed (join bridge pieces across map-tile overlap, land bridges on higher ground, treat short road pieces
  between bridge pieces as bridge). The owner has not yet confirmed it.
- **Road levelling** (`burnRoads`). Pushed after the owner said sloped roads were bumpy and tilted. Not confirmed.
- **swisstopo street tiles.** Assumes zoom 14 tiles with OpenMapTiles layers `transportation`, `transportation_name`,
  `building`, `water`, `waterway`, `landcover`, `landuse`. Not seen with real data. Unknown: whether footprints are
  present at zoom 14, and how pedestrian streets are classed.
- **Building models.** The riskiest part. Unknowns: size and structure of `tileset.json` (explicit tree assumed;
  external tilesets and ADD or REPLACE refinement are handled), bounding-volume type, whether tiles carry
  `RTC_CENTER`, glTF up axis (chosen from the data), whether `_BATCHID` survives Draco decoding in GLTFLoader r128
  (needed to seat houses one by one), roof and wall split by mesh (guessed from face directions), load time and
  memory on a phone. There is a 75 second limit, after which block houses are used.

## How to debug with the owner

The owner tests on an Android phone and sends screenshots. The PAUSE screen shows one info line with the source and
details for map, terrain, bridges and houses, or the failure reason. Ask for that screenshot first.
`#terrain-test` at the end of the address plus Practice Town loads Bern's terrain and houses under the practice
streets, which separates terrain and model problems from street-map problems.

## Open questions and next steps

1. Get the owner's screenshots for bridges and for the swisstopo streets and houses; fix what they show.
2. If `tileset.json` proves too large or slow, find the tile grid and request tiles directly, or cache the tile list.
3. Possible later: swisstopo bridge models (`ch.swisstopo.swisstlm3d.3d`), trees (`ch.swisstopo.vegetation.3d`),
   more Swiss cities, gravity on slopes, traffic.

## History in brief

- Started as a worldwide game on OpenStreetMap via Overpass; the public Overpass servers were overloaded, so the map
  moved to OpenFreeMap vector tiles.
- The owner asked for swisstopo models and terrain, then narrowed the scope to Bern and swisstopo data only.
  City search, other cities and Overpass were removed.
- The previous agent could not reach any of the data servers or the three.js CDN from its workspace, so nothing was
  ever rendered there. GitHub Pages also had to be switched on by the owner in the repo settings.

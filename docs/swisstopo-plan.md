# Plan: swisstopo terrain and buildings for Bern

Status (11 November 2026): everything in this plan is confirmed against swisstopo's real servers in headless Chrome. All five Bern spots load swisstopo streets, terrain and building models; `node tests/browser/real_check.js` checks this. The pause screen reports what loaded.

## Data sources (open, no key)

- Streets: base vector tiles in the OpenMapTiles layout, `https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/tiles.json`.

- Terrain: Cesium quantized-mesh tiles, `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json`,
  tiles at `.../v1/{z}/{x}/{y}.terrain` (TMS, global-geodetic profile, lat/lon).
- Buildings: swissBUILDINGS3D as Cesium 3D Tiles, `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json`.
  Tiles are `.b3dm` (glTF with Draco compression, no textures, roof and wall materials).
- Docs: https://docs.geo.admin.ch/visualize-data/3d-tiles.html
- Attribution needed in the game footer: "© swisstopo".

## Step 1: terrain

1. Fetch and decode the quantized-mesh tiles covering the 1.1 km play area; build a height lookup `heightAt(x, z)`.
2. Render the ground as a terrain mesh instead of the flat plane.
3. Drape roads, parks and water on the terrain (subdivide long segments, sample height per vertex).
4. Raise OpenFreeMap buildings to the terrain height at their footprint.
5. Car follows the terrain: y from `heightAt`, pitch and roll from the slope; camera follows.
6. Stars, trees and the minimap use the same height lookup.

## Step 2: building models

1. Walk `tileset.json` to the tiles that intersect the play area.
2. Parse `.b3dm`, load the glTF with three.js GLTFLoader and DRACOLoader (r128 `examples/js` builds on jsDelivr).
3. Convert from Earth-centred coordinates to the game's local metres; check heights against the terrain.
4. Replace the extruded OpenFreeMap buildings inside Switzerland; keep them as the fallback elsewhere.
5. Collision keeps using footprints (from OpenFreeMap, or derived from the models).

## Testing

- `node tests/core-assert.js`: logic tests for `js/core.js`, no browser or network needed.
- `node tests/browser/real_check.js [spot ...] [--shots dir]`: opens the game in headless Chrome (Playwright), loads each spot with real data, drives, pauses and returns to the menu. It fails when a spot does not load, falls back to a simpler source, or the page throws. `--shots` saves a screenshot per spot; look at them after any change to rendering.
- `GMA.dev()` in the browser console returns the scene, camera, car and world, for moving the camera in tests.
- `#terrain-test` at the end of the address plus Practice Town puts the practice streets on Bern's real terrain and houses.

The agent workspace needs network access to `vectortiles.geo.admin.ch`, `3d.geo.admin.ch`, `tiles.openfreemap.org`, `cdnjs.cloudflare.com` and `cdn.jsdelivr.net`. Headless Chrome renders in software at a few frames per second with a full city, so judge speed on a real device.

## Found by testing (fixed)

- The building models carry house ids as floats that are not always whole, positive numbers. The wall colour lookup returned nothing for those and every city failed with "Something broke". Ids are now tidied, and if drawing the models fails the game falls back to simple blocks.
- A spot holds about 4 million model points. Houses beyond the fog are now dropped (about 10 to 15 percent) and colours are stored as bytes.
- The bare ground rendered almost white; it is now sand coloured.

## Open

- Speed on phones is untested: about 1 million triangles are in view in the old town. If it stutters, shorten the fog distance or thin the models.
- Many streets show as "Street": check which name fields the swisstopo tiles carry.
- Water shimmers when seen from high up (it lies very close to the terrain).

## Step 3: trees and bridges (done, 11 November 2026)

- Trees: `ch.swisstopo.vegetation.3d` is 3D Tiles with `.i3dm` tiles inside `.cmpt` bundles. Each instance has an
  Earth-centred position and a scale that is the tree height in metres; the tree model is one generic shape, so the
  game reads only position and height (`C.parseTrees`, `C.realTrees`) and draws its own pointed and round trees.
  About 4,500 trees per spot, 2,000 shown after dropping those outside the map, on roads or in houses.
- Bridges: `ch.swisstopo.swisstlm3d.3d` was tried and dropped. It holds only thin flat ribbons along roads and
  rails on structures, no piers or arches. The game instead builds piers and arched side walls under its own bridge
  decks (`C.bridgeParts`).
- Houses: swissBUILDINGS3D 3.0 is already the most detailed open model (roof shapes, dormers, towers, no textures).

## Ideas for later

- Facade detail on the house models (windows as a texture or colour bands), since swisstopo has no textured models.
- Named landmarks as star spots (Zytglogge, Münster, Bundeshaus).

# Plan: swisstopo terrain and buildings for Bern

Status: step 1 (terrain) is written but was built without access to swisstopo's servers, so it is only tested against synthetic tiles. Step 2 (building models) not started. Agreed order: terrain first, then building models. Bern (46.9480, 7.4474) is the test map.

## Data sources (open, no key)

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

Open the game with `#terrain-test` at the end of the address and pick Practice Town: this puts the practice streets on Bern's real terrain, which isolates terrain problems from map problems.


The agent workspace needs network access to: `3d.geo.admin.ch`, `tiles.openfreemap.org`, `cdnjs.cloudflare.com`,
`cdn.jsdelivr.net`. With those allowed, load the game in headless Chrome and check real screenshots of Bern.
Logic tests for `js/core.js` run in Node without a browser.

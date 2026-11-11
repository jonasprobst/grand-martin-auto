// Logic tests for js/core.js. Run: node tests/core-assert.js
const assert = require('assert');
const C = require('../js/core.js');

// practice town can be indexed, spawned in and driven
const w = C.practiceTown();
C.indexWorld(w);
const sp = C.pickSpawn(w);
const s = { x: sp.x, z: sp.z, h: sp.h, v: 0, steer: 0, onRoad: true, street: '', y: 0, vy: 0, pitch: 0, roll: 0 };
for (let i = 0; i < 300; i++) C.stepCar(s, { up: 1, down: 0, left: 0, right: 0, brake: 0 }, 1 / 60, w);
assert(Math.hypot(s.x - sp.x, s.z - sp.z) > 20, 'the car moves when the gas is held');
assert(s.v > 5 && s.v <= C.MAXV + 1e-6, 'speed is within limits');
const stars = C.placeStars(w, 5, s.x, s.z, C.mulberry32(1), []);
assert.strictEqual(stars.length, 5, 'five stars are placed');

// cropPrim keeps whole houses that touch the play square and drops the rest
const tri = (x, z) => [x, 0, z, x + 1, 0, z, x, 5, z + 1];
const prim = { pos: Float64Array.from([].concat(tri(0, 0), tri(99, 0), tri(500, 500))), batch: Float32Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]), index: null };
const c = C.cropPrim(prim, 100);
assert.strictEqual(c.index.length, 6, 'two of three houses are kept');
assert.strictEqual(c.pos.length, 18);
assert.deepStrictEqual(Array.from(c.batch), [1, 1, 1, 2, 2, 2]);
const c2 = C.cropPrim({ pos: prim.pos, batch: null, index: Uint16Array.from([0, 1, 2, 6, 7, 8]) }, 100);
assert.strictEqual(c2.index.length, 3, 'without ids, triangles are kept one by one');

// seatBuildings puts each house on its own ground
const p2 = { pos: Float64Array.from([].concat(tri(0, 0), tri(50, 0))), batch: Float32Array.from([0, 0, 0, 1, 1, 1]) };
p2.pos[1] = p2.pos[4] = 500; p2.pos[7] = 505;
C.seatBuildings([p2], x => (x > 25 ? 10 : 2), 0);
assert(Math.abs(p2.pos[1] - 1.7) < 1e-6 && Math.abs(p2.pos[10] - 9.7) < 1e-6, 'houses sit 0.3 m into their ground');

// Earth-centred coordinates round-trip through the local frame
const f = C.localFrame(46.948, 7.4474), e = C.ecef(46.949, 7.449, 540), q = f(e[0], e[1], e[2]);
assert(Math.abs(q[1] - 540) < 0.1 && Math.abs(q[0] - 121.8) < 2 && Math.abs(q[2] + 111.2) < 2, 'local frame is east, up, south in metres: ' + q);

console.log('core tests passed');

// parseTrees reads an i3dm tile wrapped in a cmpt bundle
{
  const ft = Buffer.from(JSON.stringify({ INSTANCES_LENGTH: 2, POSITION: { byteOffset: 0 }, SCALE: { byteOffset: 24 } }).padEnd(96, ' '));
  const bin = Buffer.alloc(32); [1, 2, 3, 4, 5, 6].forEach((v, i) => bin.writeFloatLE(v, i * 4)); bin.writeFloatLE(12, 24); bin.writeFloatLE(20, 28);
  const head = Buffer.alloc(32); head.write('i3dm'); head.writeUInt32LE(1, 4); head.writeUInt32LE(32 + ft.length + bin.length, 8); head.writeUInt32LE(ft.length, 12); head.writeUInt32LE(bin.length, 16);
  const inner = Buffer.concat([head, ft, bin]), ch = Buffer.alloc(16); ch.write('cmpt'); ch.writeUInt32LE(1, 4); ch.writeUInt32LE(16 + inner.length * 2, 8); ch.writeUInt32LE(2, 12);
  const all = Buffer.concat([ch, inner, inner]), t = C.parseTrees(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
  assert.deepStrictEqual(t.pos, [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(t.size, [12, 20, 12, 20]);
}
// realTrees drops trees on roads and outside the map
{
  const road = w.roads[0].pts[0];
  const rt = C.realTrees(w, { pos: [road[0], 0, road[1], 9999, 0, 0, 33, 0, 47], size: [10, 10, 16] }, 100);
  assert(rt.length <= 1 && rt.every(t => t[2] === 2), 'only the tree off the road and inside the map can stay: ' + JSON.stringify(rt));
}
// bridgeParts gives a high deck piers and leaves a deck on the ground alone
{
  const pts = []; for (let i = 0; i <= 12; i++) pts.push([i * 8, 0]);
  const hi = C.bridgeParts({ roads: [{ pts: pts, w: 8, ys: pts.map(() => 20) }], heightAt: () => 0 });
  const lo = C.bridgeParts({ roads: [{ pts: pts, w: 8, ys: pts.map(() => 1.2) }], heightAt: () => 0 });
  assert(hi.pos.length > 0 && lo.pos.length === 0 && hi.pos.length === hi.col.length);
}
console.log('tree and bridge tests passed');

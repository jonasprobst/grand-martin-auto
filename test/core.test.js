// Logic tests for js/core.js. Run: node test/core.test.js
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

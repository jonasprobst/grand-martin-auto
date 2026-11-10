/* Grand Martin Auto: world data, geometry and car physics. No DOM, no three.js, so it runs in Node tests too. */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // highway type -> [width in metres, kind]  kind 1 = normal street, 2 = service lane, 3 = pedestrian
  const ROAD = {
    motorway: [14, 1], trunk: [12, 1], primary: [11, 1], secondary: [10, 1], tertiary: [9, 1],
    unclassified: [7.5, 1], residential: [7.5, 1], living_street: [6, 1],
    motorway_link: [7, 1], trunk_link: [7, 1], primary_link: [7, 1], secondary_link: [7, 1], tertiary_link: [7, 1],
    service: [4.5, 2], pedestrian: [5, 3]
  };
  const GREEN = { park: 1, garden: 1, pitch: 1, playground: 1, golf_course: 1, grass: 1, meadow: 1, recreation_ground: 1, village_green: 1, cemetery: 1, grassland: 1 };
  const WOOD = { forest: 1, wood: 1, scrub: 1 };

  function overpassQuery(lat, lon, half) {
    const dLat = half / 110540, dLon = half / (111320 * Math.cos(lat * Math.PI / 180));
    const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(6)).join(',');
    const hw = Object.keys(ROAD).join('|');
    return '[out:json][timeout:25];(' +
      'way["highway"~"^(' + hw + ')$"](' + bb + ');' +
      'way["building"](' + bb + ');' +
      'way["leisure"~"^(park|garden|pitch|playground|golf_course)$"](' + bb + ');' +
      'way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"](' + bb + ');' +
      'way["natural"~"^(water|wood|scrub|grassland)$"](' + bb + ');' +
      'way["waterway"~"^(river|canal|stream)$"](' + bb + ');' +
      ');out geom;';
  }

  function polyArea(p) {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return a / 2;
  }

  function parseOSM(json, lat0, lon0, half) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), kz = 110540;
    const w = { half: half, roads: [], buildings: [], areas: [], rivers: [] };
    const els = (json && json.elements) || [];
    for (const el of els) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
      const t = el.tags || {};
      const g = el.geometry;
      const pts = [];
      for (const q of g) { if (q) pts.push([(q.lon - lon0) * kx, -(q.lat - lat0) * kz]); }
      if (pts.length < 2) continue;
      const a = g[0], b = g[g.length - 1];
      const closed = a && b && a.lat === b.lat && a.lon === b.lon && pts.length >= 4;
      if (t.highway && ROAD[t.highway]) {
        if (t.area === 'yes') continue;
        if (t.tunnel && t.tunnel !== 'building_passage' && t.tunnel !== 'no') continue;
        const r = ROAD[t.highway];
        w.roads.push({ pts: pts, w: r[0], kind: r[1], name: t.name || '' });
      } else if (t.building && closed) {
        const poly = pts.slice(0, -1);
        const ar = Math.abs(polyArea(poly));
        if (ar < 8) continue;
        let h = parseFloat(t.height);
        if (!isFinite(h)) {
          const lv = parseFloat(t['building:levels']);
          h = isFinite(lv) ? lv * 3.3 + 1 : 7 + (el.id % 5) * 2.5 + (ar > 700 ? 5 : 0);
        }
        h = Math.max(3, Math.min(200, h));
        w.buildings.push({ pts: poly, h: h, id: el.id || 0 });
      } else if (t.waterway) {
        w.rivers.push({ pts: pts, w: t.waterway === 'river' ? 26 : t.waterway === 'canal' ? 12 : 4 });
      } else if (closed) {
        let type = null;
        if (t.natural === 'water') type = 'water';
        else if (WOOD[t.natural] || WOOD[t.landuse]) type = 'wood';
        else if (GREEN[t.leisure] || GREEN[t.landuse] || GREEN[t.natural]) type = 'green';
        if (type) w.areas.push({ pts: pts.slice(0, -1), type: type });
      }
    }
    return w;
  }

  // A made-up grid town, used when no map server can be reached.
  function practiceTown() {
    const rnd = mulberry32(7);
    const S = 90, N = 5, E = N * S;
    const w = { half: 550, roads: [], buildings: [], areas: [], rivers: [], name: 'Practice Town' };
    const ew = ['Apple', 'Banana', 'Cherry', 'Dragon', 'Eagle', 'Main', 'Fox', 'Giraffe', 'Honey', 'Ice Cream', 'Jelly'];
    const ns = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Rocket', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Last'];
    for (let i = -N; i <= N; i++) {
      const a = [], b = [];
      for (let k = -N; k <= N; k++) { a.push([k * S, i * S]); b.push([i * S, k * S]); }
      const wide = i % 3 === 0 ? 10 : 7.5;
      w.roads.push({ pts: a, w: wide, kind: 1, name: ew[i + N] + ' Street' });
      w.roads.push({ pts: b, w: wide, kind: 1, name: ns[i + N] + ' Avenue' });
    }
    const parks = { '0,0': 1, '-1,0': 1, '2,-3': 1, '-4,2': 1, '3,3': 1 }, ponds = { '-3,-3': 1, '1,2': 1 };
    let id = 1;
    for (let bx = -N; bx < N; bx++) for (let bz = -N; bz < N; bz++) {
      const x0 = bx * S + 9, z0 = bz * S + 9, x1 = x0 + S - 18, z1 = z0 + S - 18, key = bx + ',' + bz;
      if (parks[key] || ponds[key]) {
        w.areas.push({ pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], type: parks[key] ? 'green' : 'water' });
        continue;
      }
      const m = (x0 + x1) / 2, mz = (z0 + z1) / 2, g = 3;
      const cells = [[x0, z0, m - g, mz - g], [m + g, z0, x1, mz - g], [x0, mz + g, m - g, z1], [m + g, mz + g, x1, z1]];
      const centre = 1 - Math.min(1, Math.hypot(m, mz) / 420);
      for (const c of cells) {
        if (rnd() < 0.08) continue;
        w.buildings.push({ pts: [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]], h: 6 + rnd() * 10 + centre * rnd() * 45, id: id++ });
      }
    }
    return w;
  }

  // Ear clipping. Returns index triples, all counter-clockwise in (x, z).
  function triangulate(p) {
    const n = p.length, out = [];
    if (n < 3) return out;
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    if (polyArea(p) < 0) idx.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let guard = n * 3 + 10;
    while (idx.length > 3 && guard-- > 0) {
      let cut = false;
      const m = idx.length;
      for (let i = 0; i < m; i++) {
        const ia = idx[(i + m - 1) % m], ib = idx[i], ic = idx[(i + 1) % m];
        const a = p[ia], b = p[ib], c = p[ic];
        if (cross(a, b, c) <= 1e-9) continue;
        let ok = true;
        for (let k = 0; k < m; k++) {
          const j = idx[k];
          if (j === ia || j === ib || j === ic) continue;
          const q = p[j];
          if (cross(a, b, q) > 1e-9 && cross(b, c, q) > 1e-9 && cross(c, a, q) > 1e-9) { ok = false; break; }
        }
        if (ok) { out.push(ia, ib, ic); idx.splice(i, 1); cut = true; break; }
      }
      if (!cut) { // odd shape: clip anyway so we always finish
        if (cross(p[idx[0]], p[idx[1]], p[idx[2]]) > 0) out.push(idx[0], idx[1], idx[2]);
        idx.splice(1, 1);
      }
    }
    if (idx.length === 3 && cross(p[idx[0]], p[idx[1]], p[idx[2]]) > 0) out.push(idx[0], idx[1], idx[2]);
    return out;
  }

  function thin(p, max) {
    if (p.length <= max) return p;
    const k = Math.ceil(p.length / max), o = [];
    for (let i = 0; i < p.length; i += k) o.push(p[i]);
    return o;
  }

  function rgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  const COL = {
    green: rgb('#8fdc6c'), wood: rgb('#62c15a'), water: rgb('#4dbdff'),
    pave: rgb('#d3cbbb'), road: rgb('#4a4d66'), service: rgb('#6c7088'), ped: rgb('#ecdfc4'), line: rgb('#ffe9a0')
  };

  function ribbon(pts, width, y, c, pos, col) {
    const n = pts.length;
    if (n < 2) return;
    const L = [], R = [], hw = width / 2;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * hw, nz = dx / len * hw;
      L.push([pts[i][0] + nx, pts[i][1] + nz]); R.push([pts[i][0] - nx, pts[i][1] - nz]);
    }
    for (let i = 0; i < n - 1; i++) {
      pos.push(L[i][0], y, L[i][1], R[i][0], y, R[i][1], L[i + 1][0], y, L[i + 1][1],
        R[i][0], y, R[i][1], R[i + 1][0], y, R[i + 1][1], L[i + 1][0], y, L[i + 1][1]);
      for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2]);
    }
  }

  function disc(x, z, r, y, c, pos, col) {
    const N = 8;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, b = (i + 1) / N * Math.PI * 2;
      pos.push(x, y, z, x + Math.cos(a) * r, y, z + Math.sin(a) * r, x + Math.cos(b) * r, y, z + Math.sin(b) * r);
      col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
    }
  }

  // Everything that lies flat on the ground, as one coloured triangle list.
  function buildFlat(w) {
    const pos = [], col = [];
    for (const a of w.areas) {
      const p = thin(a.pts, 300), tri = triangulate(p), c = COL[a.type];
      for (let i = 0; i < tri.length; i++) { const q = p[tri[i]]; pos.push(q[0], 0.03, q[1]); col.push(c[0], c[1], c[2]); }
    }
    for (const r of w.rivers) ribbon(r.pts, r.w, 0.06, COL.water, pos, col);
    for (const r of w.roads) if (r.kind !== 3) ribbon(r.pts, r.w + 3.2, 0.09, COL.pave, pos, col);
    for (const r of w.roads) {
      const c = r.kind === 1 ? COL.road : r.kind === 2 ? COL.service : COL.ped;
      ribbon(r.pts, r.w, 0.13, c, pos, col);
      const a = r.pts[0], b = r.pts[r.pts.length - 1];
      disc(a[0], a[1], r.w / 2, 0.13, c, pos, col); disc(b[0], b[1], r.w / 2, 0.13, c, pos, col);
    }
    for (const r of w.roads) if (r.kind === 1 && r.w >= 7) ribbon(r.pts, 0.3, 0.17, COL.line, pos, col);
    return { pos: pos, col: col };
  }

  const PALETTE = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fff1e6', '#ffadad', '#f1e3d3'].map(rgb);

  function buildBuildings(w) {
    const pos = [], nor = [], col = [], uv = [];
    for (const b of w.buildings) {
      let p = thin(b.pts, 200);
      if (p.length < 3) continue;
      if (polyArea(p) > 0) p = p.slice().reverse(); // walk clockwise so wall normals point outward
      const c = PALETTE[Math.abs(b.id) % PALETTE.length], h = b.h, n = p.length;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const A = p[i], B = p[(i + 1) % n];
        const dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = -dz / len, nz = dx / len, u1 = u + len / 4, v1 = h / 3.5;
        pos.push(A[0], 0, A[1], B[0], 0, B[1], B[0], h, B[1], A[0], 0, A[1], B[0], h, B[1], A[0], h, A[1]);
        uv.push(u, 0, u1, 0, u1, v1, u, 0, u1, v1, u, v1);
        for (let k = 0; k < 6; k++) { nor.push(nx, 0, nz); col.push(c[0], c[1], c[2]); }
        u = u1;
      }
      const tri = triangulate(p);
      for (let i = 0; i < tri.length; i += 3) {
        const o = [tri[i], tri[i + 2], tri[i + 1]]; // flip so the roof faces up
        for (const j of o) {
          pos.push(p[j][0], h, p[j][1]); nor.push(0, 1, 0); uv.push(0.02, 0.02);
          col.push(c[0] * 0.72, c[1] * 0.72, c[2] * 0.72);
        }
      }
    }
    return { pos: pos, nor: nor, col: col, uv: uv };
  }

  function pip(p, x, z) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i], b = p[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // Adds fast lookups to the world: nearestRoad(x, z) and hitBuilding(x, z).
  function indexWorld(w) {
    const RC = 40, BC = 50, M = 18;
    const rg = new Map(), bg = new Map();
    const key = (a, b) => a * 100003 + b;
    const add = (g, k, v) => { const l = g.get(k); if (l) l.push(v); else g.set(k, [v]); };
    for (const r of w.roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        if (Math.abs(a[0]) > w.half + 200 && Math.abs(b[0]) > w.half + 200) continue;
        if (Math.abs(a[1]) > w.half + 200 && Math.abs(b[1]) > w.half + 200) continue;
        const seg = { r: r, i: i };
        const x0 = Math.floor((Math.min(a[0], b[0]) - M) / RC), x1 = Math.floor((Math.max(a[0], b[0]) + M) / RC);
        const z0 = Math.floor((Math.min(a[1], b[1]) - M) / RC), z1 = Math.floor((Math.max(a[1], b[1]) + M) / RC);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) add(rg, key(cx, cz), seg);
      }
    }
    for (const b of w.buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const q of b.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      b.bb = [x0, z0, x1, z1];
      for (let cx = Math.floor(x0 / BC); cx <= Math.floor(x1 / BC); cx++)
        for (let cz = Math.floor(z0 / BC); cz <= Math.floor(z1 / BC); cz++) add(bg, key(cx, cz), b);
    }
    w.nearestRoad = function (x, z) {
      const l = rg.get(key(Math.floor(x / RC), Math.floor(z / RC)));
      if (!l) return null;
      let best = null, bd = Infinity;
      for (const s of l) {
        const a = s.r.pts[s.i], b = s.r.pts[s.i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
        let t = L ? ((x - a[0]) * dx + (z - a[1]) * dz) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - s.r.w / 2; // distance to the road edge
        if (d < bd) { bd = d; best = s; }
      }
      return { d: bd, r: best.r };
    };
    w.hitBuilding = function (x, z) {
      const l = bg.get(key(Math.floor(x / BC), Math.floor(z / BC)));
      if (!l) return false;
      for (const b of l) {
        const bb = b.bb;
        if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
        if (pip(b.pts, x, z)) return true;
      }
      return false;
    };
    return w;
  }

  function pickSpawn(w) {
    let best = null, bd = Infinity;
    for (const pass of [1, 0]) {
      for (const r of w.roads) {
        if (pass && r.kind !== 1) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, d = Math.hypot(mx, mz);
          if (d < bd && Math.hypot(b[0] - a[0], b[1] - a[1]) > 4) { bd = d; best = { x: mx, z: mz, h: Math.atan2(b[0] - a[0], b[1] - a[1]) }; }
        }
      }
      if (best) break;
    }
    return best || { x: 0, z: 0, h: 0 };
  }

  function placeStars(w, n, cx, cz, rnd, existing) {
    const lim = w.half - 40, out = [], all = (existing || []).slice();
    let roads = w.roads.filter(r => r.kind === 1);
    if (roads.length < 3) roads = w.roads;
    if (!roads.length) return out;
    for (let tries = 0; out.length < n && tries < 4000; tries++) {
      const r = roads[Math.floor(rnd() * roads.length)];
      const i = Math.floor(rnd() * (r.pts.length - 1)), t = rnd();
      const a = r.pts[i], b = r.pts[i + 1];
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      const relax = tries > 2000 ? 0.3 : 1;
      if (Math.hypot(x - cx, z - cz) < 70 * relax) continue;
      if (all.some(s => Math.hypot(s.x - x, s.z - z) < 90 * relax)) continue;
      const s = { x: x, z: z };
      out.push(s); all.push(s);
    }
    return out;
  }

  function placeTrees(w, rnd) {
    const out = [];
    for (const a of w.areas) {
      if (a.type === 'water' || out.length > 600) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const q of a.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      const want = Math.min(a.type === 'wood' ? 90 : 35, Math.ceil(Math.abs(polyArea(a.pts)) / (a.type === 'wood' ? 120 : 260)));
      for (let k = 0, got = 0; k < want * 4 && got < want; k++) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
        if (Math.abs(x) > w.half + 60 || Math.abs(z) > w.half + 60) continue;
        if (!pip(a.pts, x, z)) continue;
        const nr = w.nearestRoad(x, z);
        if (nr && nr.d < 3) continue;
        if (w.hitBuilding(x, z)) continue;
        out.push([x, z, 0.8 + rnd() * 0.7]); got++;
      }
    }
    return out;
  }

  const MAXV = 25; // m/s on a street = 90 km/h

  // One physics step. s = {x, z, h, v, steer}; input values are 0 or 1.
  function stepCar(s, inp, dt, w) {
    const ev = {};
    const near = w.nearestRoad(s.x, s.z);
    s.onRoad = !!near && near.d < 1.5;
    s.street = near && near.d < 12 ? near.r.name : '';
    const max = s.onRoad ? MAXV : 12;
    const thr = inp.up - inp.down;
    if (inp.brake) s.v -= Math.sign(s.v) * Math.min(Math.abs(s.v), 32 * dt);
    else if (thr > 0) s.v += (s.v < 0 ? 26 : 13 * (1 - Math.max(0, s.v) / 27)) * dt;
    else if (thr < 0) { s.v -= (s.v > 0.3 ? 26 : 8) * dt; if (s.v < -8) s.v = -8; }
    else s.v -= Math.sign(s.v) * Math.min(Math.abs(s.v), 3.5 * dt);
    if (s.v > max) s.v = Math.max(max, s.v - 18 * dt);
    s.steer += ((inp.right - inp.left) - s.steer) * Math.min(1, dt * 9);
    const grip = Math.max(-1, Math.min(1, s.v / 6));
    s.h -= s.steer * 2.0 * grip / (1 + Math.abs(s.v) / 45) * dt;
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    let nx = s.x + fx * s.v * dt, nz = s.z + fz * s.v * dt;
    const nr = w.nearestRoad(nx, nz);
    if (!(nr && nr.d < 1)) { // streets are always free to drive, even through passages
      const sg = s.v >= 0 ? 1 : -1;
      if ((w.hitBuilding(nx + fx * 2.1 * sg, nz + fz * 2.1 * sg) || w.hitBuilding(nx, nz)) && !w.hitBuilding(s.x, s.z)) {
        ev.bump = Math.abs(s.v); s.v = -s.v * 0.35; nx = s.x; nz = s.z;
      }
    }
    const L = w.half + 40;
    if (Math.abs(nx) > L || Math.abs(nz) > L) {
      nx = Math.max(-L, Math.min(L, nx)); nz = Math.max(-L, Math.min(L, nz));
      ev.edge = true; s.v *= 0.9;
    }
    s.x = nx; s.z = nz;
    return ev;
  }

  const api = {
    mulberry32: mulberry32, overpassQuery: overpassQuery, parseOSM: parseOSM, practiceTown: practiceTown,
    triangulate: triangulate, polyArea: polyArea, buildFlat: buildFlat, buildBuildings: buildBuildings,
    indexWorld: indexWorld, pickSpawn: pickSpawn, placeStars: placeStars, placeTrees: placeTrees,
    stepCar: stepCar, MAXV: MAXV
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GMA = api;
})(this);

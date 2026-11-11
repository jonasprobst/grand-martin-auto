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

  // Metres per degree of longitude and latitude at a given latitude (WGS84 ellipsoid).
  function scale(lat) {
    const p = lat * Math.PI / 180;
    return [111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p), 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p)];
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
    const sc = scale(lat), dLat = half / sc[1], dLon = half / sc[0];
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
    const sc = scale(lat0), kx = sc[0], kz = sc[1];
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
        w.roads.push({ pts: pts, w: r[0], kind: r[1], name: t.name || '', bridge: !!t.bridge && t.bridge !== 'no' });
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


  // ---------- vector tiles (OpenMapTiles schema, e.g. OpenFreeMap) ----------
  function decodeMVT(buf) {
    let pos = 0;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), td = new TextDecoder();
    const vi = () => { let r = 0, m = 1, b; do { b = buf[pos++]; r += (b & 127) * m; m *= 128; } while ((b & 128) && pos < buf.length); return r; };
    const skip = w => {
      if (w === 0) vi(); else if (w === 1) pos += 8; else if (w === 2) { const l = vi(); pos += l; } else if (w === 5) pos += 4; else throw new Error('bad tile');
    };
    const str = () => { const l = vi(), v = td.decode(buf.subarray(pos, pos + l)); pos += l; return v; };
    const packed = (w, out) => { if (w === 2) { const e = vi() + pos; while (pos < e) out.push(vi()); } else out.push(vi()); };
    const layers = {};
    while (pos < buf.length) {
      const k = vi();
      if (Math.floor(k / 8) !== 3 || (k & 7) !== 2) { skip(k & 7); continue; }
      const lend = vi() + pos, L = { name: '', extent: 4096, keys: [], values: [], feats: [] };
      while (pos < lend) {
        const k2 = vi(), f = Math.floor(k2 / 8), w = k2 & 7;
        if (f === 1 && w === 2) L.name = str();
        else if (f === 2 && w === 2) {
          const fend = vi() + pos, F = { type: 0, tags: [], geom: [] };
          while (pos < fend) {
            const k3 = vi(), f3 = Math.floor(k3 / 8), w3 = k3 & 7;
            if (f3 === 2) packed(w3, F.tags); else if (f3 === 3 && w3 === 0) F.type = vi(); else if (f3 === 4) packed(w3, F.geom); else skip(w3);
          }
          pos = fend; L.feats.push(F);
        } else if (f === 3 && w === 2) L.keys.push(str());
        else if (f === 4 && w === 2) {
          const vend = vi() + pos; let val = null;
          while (pos < vend) {
            const k4 = vi(), f4 = Math.floor(k4 / 8), w4 = k4 & 7;
            if (f4 === 1 && w4 === 2) val = str();
            else if (f4 === 2 && w4 === 5) { val = dv.getFloat32(pos, true); pos += 4; }
            else if (f4 === 3 && w4 === 1) { val = dv.getFloat64(pos, true); pos += 8; }
            else if ((f4 === 4 || f4 === 5) && w4 === 0) val = vi();
            else if (f4 === 6 && w4 === 0) { const n = vi(); val = n % 2 ? -(n + 1) / 2 : n / 2; }
            else if (f4 === 7 && w4 === 0) val = !!vi();
            else skip(w4);
          }
          pos = vend; L.values.push(val);
        } else if (f === 5 && w === 0) L.extent = vi();
        else skip(w);
      }
      pos = lend; layers[L.name] = L;
    }
    return layers;
  }

  function mvtRings(F) {
    const g = F.geom, out = [], zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
    let x = 0, y = 0, i = 0, cur = null;
    while (i < g.length) {
      const c = g[i++], cmd = c & 7, n = c >> 3;
      if (cmd === 1) for (let k = 0; k < n && i + 1 < g.length; k++) { x += zz(g[i++]); y += zz(g[i++]); if (cur) out.push(cur); cur = [[x, y]]; }
      else if (cmd === 2) for (let k = 0; k < n && i + 1 < g.length; k++) { x += zz(g[i++]); y += zz(g[i++]); if (cur) cur.push([x, y]); }
      else if (cmd !== 7) break;
    }
    if (cur) out.push(cur);
    return out;
  }

  function tileList(lat, lon, half, z) {
    const sc = scale(lat), n = Math.pow(2, z), dLat = half / sc[1], dLon = half / sc[0];
    const tx = l => Math.floor((l + 180) / 360 * n);
    const ty = l => { const r = l * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const out = [];
    for (let x = tx(lon - dLon); x <= tx(lon + dLon); x++)
      for (let y = ty(lat + dLat); y <= ty(lat - dLat); y++)
        if (y >= 0 && y < n) out.push({ z: z, x: ((x % n) + n) % n, y: y });
    return out.slice(0, 12);
  }

  const TROAD = { motorway: [14, 1], trunk: [12, 1], primary: [11, 1], secondary: [10, 1], tertiary: [9, 1], minor: [7.5, 1], service: [4.5, 2] };

  // tiles: [{z, x, y, layers}] with layers from decodeMVT
  function worldFromTiles(tiles, lat0, lon0, half) {
    const sc = scale(lat0), kx = sc[0], kz = sc[1], lim = half + 150;
    const w = { half: half, roads: [], buildings: [], areas: [], rivers: [] };
    const names = new Map(), NC = 30, nkey = (a, b) => a * 100003 + b;
    for (const t of tiles) {
      const n = Math.pow(2, t.z);
      const each = (layerName, fn) => {
        const L = t.layers && t.layers[layerName];
        if (!L) return;
        const e = L.extent || 4096;
        for (const F of L.feats) {
          const props = {};
          for (let i = 0; i + 1 < F.tags.length; i += 2) props[L.keys[F.tags[i]]] = L.values[F.tags[i + 1]];
          for (const ring of mvtRings(F)) {
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            const pts = ring.map(p => {
              const lon = (t.x + p[0] / e) / n * 360 - 180;
              const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (t.y + p[1] / e) / n))) * 180 / Math.PI;
              const X = (lon - lon0) * kx, Z = -(lat - lat0) * kz;
              if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
              return [X, Z];
            });
            if (x0 > lim || x1 < -lim || z0 > lim || z1 < -lim) continue;
            fn(F.type, props, pts);
          }
        }
      };
      each('transportation', (type, p, pts) => {
        if (type !== 2 || pts.length < 2 || p.brunnel === 'tunnel') return;
        const r = TROAD[p.class] || (p.class === 'path' && p.subclass === 'pedestrian' ? [5, 3] : null);
        if (r) w.roads.push({ pts: pts, w: r[0], kind: r[1], name: '', bridge: p.brunnel === 'bridge' });
      });
      each('transportation_name', (type, p, pts) => {
        const name = p['name:latin'] || p.name;
        if (type !== 2 || !name) return;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, steps = Math.max(1, Math.ceil(len / 12));
          const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
          for (let k = 0; k <= steps; k++) {
            const x = a[0] + (b[0] - a[0]) * k / steps, z = a[1] + (b[1] - a[1]) * k / steps;
            const key = nkey(Math.floor(x / NC), Math.floor(z / NC)), l = names.get(key), v = [x, z, name, ux, uz];
            if (l) l.push(v); else names.set(key, [v]);
          }
        }
      });
      each('building', (type, p, pts) => {
        if (type !== 3 || pts.length < 3 || p.hide_3d) return;
        const ar = polyArea(pts);
        if (ar < 8) return; // also drops inner rings, which wind the other way
        const id = Math.abs(Math.round(pts[0][0] * 7 + pts[0][1] * 13));
        let h = +p.render_height;
        if (!(h > 0)) h = 7 + (id % 5) * 2.5 + (ar > 700 ? 5 : 0);
        w.buildings.push({ pts: pts, h: Math.max(3, Math.min(200, h)), id: id });
      });
      each('water', (type, p, pts) => {
        if (type !== 3 || pts.length < 3 || p.brunnel === 'tunnel') return;
        w.areas.push({ pts: pts, type: polyArea(pts) > 0 ? 'water' : 'land' });
      });
      each('waterway', (type, p, pts) => {
        if (type === 2 && pts.length > 1 && p.brunnel !== 'tunnel') w.rivers.push({ pts: pts, w: p.class === 'river' || p.class === 'canal' ? 8 : 3 });
      });
      each('landcover', (type, p, pts) => {
        if (type !== 3 || pts.length < 3 || polyArea(pts) <= 0) return;
        if (p.class === 'wood') w.areas.push({ pts: pts, type: 'wood' });
        else if (p.class === 'grass') w.areas.push({ pts: pts, type: 'green' });
      });
      each('landuse', (type, p, pts) => {
        if (type === 3 && pts.length >= 3 && polyArea(pts) > 0 && (p.class === 'cemetery' || p.class === 'pitch' || p.class === 'playground'))
          w.areas.push({ pts: pts, type: 'green' });
      });
    }
    // water first, then land patches for islands, then greenery on top
    const order = { water: 0, land: 1, green: 2, wood: 2 };
    w.areas.sort((a, b) => order[a.type] - order[b.type]);
    for (const r of w.roads) {
      const m = r.pts.length >> 1, a = r.pts[Math.max(0, m - 1)], b = r.pts[m], e = r.pts.length - 1;
      const dir = (p, q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
      // probe points along the road, each with the road's direction there, so crossing streets do not lend their name
      const probes = [[[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dir(a, b)], [b, dir(a, b)], [r.pts[0], dir(r.pts[0], r.pts[1])], [r.pts[e], dir(r.pts[e - 1], r.pts[e])]];
      let best = '', bd = 18;
      for (const pr of probes) {
        const q = pr[0], u = pr[1], cx = Math.floor(q[0] / NC), cz = Math.floor(q[1] / NC);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const l = names.get(nkey(cx + i, cz + j));
          if (!l) continue;
          for (const v of l) {
            if (Math.abs(v[3] * u[0] + v[4] * u[1]) < 0.8) continue;
            const d = Math.hypot(v[0] - q[0], v[1] - q[1]);
            if (d < bd) { bd = d; best = v[2]; }
          }
        }
        if (best && bd < 6) break;
      }
      r.name = best;
    }
    return w;
  }

  // ---------- 3D building models (Cesium 3D Tiles, b3dm) ----------
  const WGS_A = 6378137, WGS_E2 = 6.69437999014e-3;
  function ecef(lat, lon, h) {
    const p = lat * Math.PI / 180, l = lon * Math.PI / 180, N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(p) * Math.sin(p));
    return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - WGS_E2) + h) * Math.sin(p)];
  }
  function geodetic(X, Y, Z) {
    const l = Math.atan2(Y, X), pp = Math.hypot(X, Y);
    let p = Math.atan2(Z, pp * (1 - WGS_E2)), h = 0;
    for (let i = 0; i < 6; i++) {
      const N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(p) * Math.sin(p));
      h = pp / Math.cos(p) - N;
      p = Math.atan2(Z, pp * (1 - WGS_E2 * N / (N + h)));
    }
    return [p * 180 / Math.PI, l * 180 / Math.PI, h];
  }
  // Earth-centred coordinates -> the game's local metres: [x east, y up, z south]
  function localFrame(lat0, lon0) {
    const O = ecef(lat0, lon0, 0), p = lat0 * Math.PI / 180, l = lon0 * Math.PI / 180;
    const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    return function (X, Y, Z) {
      const dx = X - O[0], dy = Y - O[1], dz = Z - O[2];
      return [-sl * dx + cl * dy, cp * cl * dx + cp * sl * dy + sp * dz, sp * cl * dx + sp * sl * dy - cp * dz];
    };
  }

  // b3dm container -> { rtc: [x, y, z] or null, glb: ArrayBuffer, version: glTF version }
  function parseB3dm(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic === 'glTF') return { rtc: null, glb: buf, version: dv.getUint32(4, true) };
    if (magic !== 'b3dm') throw new Error('not a b3dm tile (starts with "' + magic + '")');
    let ftj = dv.getUint32(12, true), ftb = dv.getUint32(16, true), btj = dv.getUint32(20, true), btb = dv.getUint32(24, true), head = 28;
    if (btj >= 570425344) { head = 20; btj = ftb; btb = 0; ftj = 0; ftb = 0; }        // very old header layouts
    else if (btb >= 570425344) { head = 24; btj = ftj; btb = ftb; ftj = 0; ftb = 0; }
    let rtc = null;
    if (ftj) {
      try {
        const j = JSON.parse(new TextDecoder().decode(u8.subarray(head, head + ftj)));
        if (Array.isArray(j.RTC_CENTER) && j.RTC_CENTER.length === 3) rtc = j.RTC_CENTER;
      } catch (e) { /* no usable feature table */ }
    }
    let at = head + ftj + ftb + btj + btb;
    const isGlb = i => u8[i] === 0x67 && u8[i + 1] === 0x6c && u8[i + 2] === 0x54 && u8[i + 3] === 0x46;
    if (!isGlb(at)) { at = -1; for (let i = head; i < u8.length - 12; i++) if (isGlb(i)) { at = i; break; } }
    if (at < 0) throw new Error('b3dm tile holds no glTF model');
    return { rtc: rtc, glb: buf.slice(at), version: dv.getUint32(at + 4, true) };
  }

  // Does a 3D Tiles bounding volume touch the play area? box = { lat, lon, R (metres) }; T = 4x4 column-major or null.
  function volumeNear(bv, T, box) {
    if (!bv) return true;
    const sc = scale(box.lat), d2r = Math.PI / 180;
    if (bv.region) {
      const r = bv.region, dLat = box.R / sc[1] * d2r, dLon = box.R / sc[0] * d2r, la = box.lat * d2r, lo = box.lon * d2r;
      return r[0] <= lo + dLon && r[2] >= lo - dLon && r[1] <= la + dLat && r[3] >= la - dLat;
    }
    let c = null, rad = 0;
    if (bv.box) { const b = bv.box; c = [b[0], b[1], b[2]]; rad = Math.hypot(b[3], b[4], b[5]) + Math.hypot(b[6], b[7], b[8]) + Math.hypot(b[9], b[10], b[11]); }
    else if (bv.sphere) { c = [bv.sphere[0], bv.sphere[1], bv.sphere[2]]; rad = bv.sphere[3]; }
    if (!c) return true;
    if (T) c = [T[0] * c[0] + T[4] * c[1] + T[8] * c[2] + T[12], T[1] * c[0] + T[5] * c[1] + T[9] * c[2] + T[13], T[2] * c[0] + T[6] * c[1] + T[10] * c[2] + T[14]];
    const g = geodetic(c[0], c[1], c[2]);
    return Math.abs((g[1] - box.lon) * sc[0]) <= box.R + rad && Math.abs((g[0] - box.lat) * sc[1]) <= box.R + rad;
  }
  function mul4(a, b) { // column-major 4x4
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }

  // Model vertices (already in the glTF scene's world space, flat x y z list) -> local metres, in place.
  // yUp: glTF convention (y up), turned to z up as 3D Tiles asks. Returns the height range, used to sanity-check yUp.
  function modelToLocal(pos, yUp, rtc, T, frame) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      let x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (yUp) { const t = y; y = -z; z = t; }
      if (rtc) { x += rtc[0]; y += rtc[1]; z += rtc[2]; }
      if (T) { const a = T[0] * x + T[4] * y + T[8] * z + T[12], b = T[1] * x + T[5] * y + T[9] * z + T[13], c = T[2] * x + T[6] * y + T[10] * z + T[14]; x = a; y = b; z = c; }
      const q = frame(x, y, z);
      pos[i] = q[0]; pos[i + 1] = q[1]; pos[i + 2] = q[2];
      if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1];
    }
    return [lo, hi];
  }

  // Sets every building on the game's ground. prims: [{ pos: local x y z list, batch: id per vertex or null }] of one tile.
  // With batch ids each building is moved on its own; without, the whole tile keeps its true height minus `base`.
  function seatBuildings(prims, heightAt, base) {
    const lows = new Map(), shifts = [];
    let ids = true;
    for (const p of prims) if (!p.batch) ids = false;
    if (!ids) {
      for (const p of prims) for (let i = 1; i < p.pos.length; i += 3) p.pos[i] -= base;
      return { perBuilding: false, count: 0, median: -base };
    }
    for (const p of prims) for (let v = 0, i = 0; i < p.pos.length; i += 3, v++) {
      const id = p.batch[v], y = p.pos[i + 1], cur = lows.get(id);
      if (cur === undefined || y < cur) lows.set(id, y);
    }
    const ground = new Map();
    for (const p of prims) for (let v = 0, i = 0; i < p.pos.length; i += 3, v++) {
      const id = p.batch[v];
      if (p.pos[i + 1] > lows.get(id) + 0.6) continue; // only the bottom ring of the building
      const g = heightAt(p.pos[i], p.pos[i + 2]), cur = ground.get(id);
      if (cur === undefined || g < cur) ground.set(id, g);
    }
    const dy = new Map();
    for (const e of lows) { const d = ground.get(e[0]) - 0.3 - e[1]; dy.set(e[0], d); shifts.push(d); }
    for (const p of prims) for (let v = 0, i = 0; i < p.pos.length; i += 3, v++) p.pos[i + 1] += dy.get(p.batch[v]);
    shifts.sort((a, b) => a - b);
    return { perBuilding: true, count: shifts.length, median: shifts.length ? shifts[shifts.length >> 1] : 0 };
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
    green: rgb('#8fdc6c'), wood: rgb('#62c15a'), water: rgb('#4dbdff'), land: rgb('#e9dfc8'),
    pave: rgb('#d3cbbb'), wall: rgb('#b9b3a6'), under: rgb('#3a3d52'), road: rgb('#4a4d66'), service: rgb('#6c7088'), ped: rgb('#ecdfc4'), line: rgb('#ffe9a0')
  };

  function edges(pts, width) {
    const n = pts.length, L = [], R = [], hw = width / 2;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * hw, nz = dx / len * hw;
      L.push([pts[i][0] + nx, pts[i][1] + nz]); R.push([pts[i][0] - nx, pts[i][1] - nz]);
    }
    return [L, R];
  }
  // ys (optional): absolute height per vertex, used for bridge decks
  function ribbon(pts, width, y, c, pos, col, ys) {
    const n = pts.length;
    if (n < 2) return;
    const e = edges(pts, width), L = e[0], R = e[1];
    for (let i = 0; i < n - 1; i++) {
      const ya = ys ? ys[i] + y : y, yb = ys ? ys[i + 1] + y : y;
      pos.push(L[i][0], ya, L[i][1], R[i][0], ya, R[i][1], L[i + 1][0], yb, L[i + 1][1],
        R[i][0], ya, R[i][1], R[i + 1][0], yb, R[i + 1][1], L[i + 1][0], yb, L[i + 1][1]);
      for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2]);
    }
  }
  // bridge: underside slab and a low wall along both sides
  function deckSides(r, pos, col) {
    const e = edges(r.pts, r.w + 3.2), ys = r.ys, c = COL.wall, u = COL.under;
    ribbon(r.pts, r.w + 3.2, -1.0, u, pos, col, ys);
    for (const S of e) for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1], a0 = ys[i] - 1, a1 = ys[i] + 0.8, b0 = ys[i + 1] - 1, b1 = ys[i + 1] + 0.8;
      pos.push(a[0], a0, a[1], b[0], b0, b[1], b[0], b1, b[1], a[0], a0, a[1], b[0], b1, b[1], a[0], a1, a[1]);
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

  // Everything that lies on the ground, as one coloured triangle list (y = small layer offset).
  // Bridge decks come back separately in dpos/dcol with real heights.
  function buildFlat(w) {
    const pos = [], col = [], dpos = [], dcol = [];
    for (const a of w.areas) {
      const p = thin(a.pts, 300), tri = triangulate(p), c = COL[a.type];
      const y = a.type === 'water' ? 0.02 : a.type === 'land' ? 0.035 : 0.05;
      for (let i = 0; i < tri.length; i++) { const q = p[tri[i]]; pos.push(q[0], y, q[1]); col.push(c[0], c[1], c[2]); }
    }
    for (const r of w.rivers) ribbon(r.pts, r.w, 0.06, COL.water, pos, col);
    for (const r of w.roads) if (r.kind !== 3) {
      if (r.ys) { ribbon(r.pts, r.w + 3.2, 0.02, COL.pave, dpos, dcol, r.ys); deckSides(r, dpos, dcol); }
      else ribbon(r.pts, r.w + 3.2, 0.09, COL.pave, pos, col);
    }
    for (const r of w.roads) {
      const c = r.kind === 1 ? COL.road : r.kind === 2 ? COL.service : COL.ped;
      if (r.ys) { ribbon(r.pts, r.w, 0.06, c, dpos, dcol, r.ys); continue; }
      ribbon(r.pts, r.w, 0.13, c, pos, col);
      const a = r.pts[0], b = r.pts[r.pts.length - 1];
      disc(a[0], a[1], r.w / 2, 0.13, c, pos, col); disc(b[0], b[1], r.w / 2, 0.13, c, pos, col);
    }
    for (const r of w.roads) if (r.kind === 1 && r.w >= 7) {
      if (r.ys) ribbon(r.pts, 0.3, 0.1, COL.line, dpos, dcol, r.ys); else ribbon(r.pts, 0.3, 0.17, COL.line, pos, col);
    }
    return { pos: pos, col: col, dpos: dpos, dcol: dcol };
  }

  // ---------- terrain ----------
  // Height grid: n x n nodes, G metres apart, covering -R..R. Each cell is two flat triangles split
  // along the diagonal from (x1, z0) to (x0, z1); heightAt uses the same split, so it matches the drawn mesh exactly.
  function makeTerrain(h, n, R, G) {
    const t = { h: h, n: n, R: R, G: G };
    t.heightAt = function (x, z) {
      let u = (x + R) / G, v = (z + R) / G;
      u = u < 0 ? 0 : u > n - 1.0001 ? n - 1.0001 : u; v = v < 0 ? 0 : v > n - 1.0001 ? n - 1.0001 : v;
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * n + i;
      const h00 = h[k], h10 = h[k + 1], h01 = h[k + n], h11 = h[k + n + 1];
      return fu + fv <= 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
    };
    return t;
  }

  // tris: flat list of x, z, height for each corner (9 numbers per triangle)
  function rasterTIN(tris, R, G) {
    const n = Math.floor(2 * R / G) + 1, h = new Float32Array(n * n).fill(NaN);
    for (let t = 0; t < tris.length; t += 9) {
      const ax = (tris[t] + R) / G, az = (tris[t + 1] + R) / G, ah = tris[t + 2];
      const bx = (tris[t + 3] + R) / G, bz = (tris[t + 4] + R) / G, bh = tris[t + 5];
      const cx = (tris[t + 6] + R) / G, cz = (tris[t + 7] + R) / G, ch = tris[t + 8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6)), i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6));
      const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) - 1e-6)), j1 = Math.min(n - 1, Math.floor(Math.max(az, bz, cz) + 1e-6));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const wa = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / den, wb = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / den, wc = 1 - wa - wb;
        if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue;
        h[j * n + i] = wa * ah + wb * bh + wc * ch;
      }
    }
    return { h: h, n: n };
  }

  // Fills gaps, smooths a little, and shifts heights so the lowest point is 0.
  function finishTerrain(h, n, R, G, blur) {
    let missing = 0;
    for (let i = 0; i < h.length; i++) if (!(h[i] === h[i])) missing++;
    if (missing > h.length * 0.4) throw new Error('terrain covers only ' + Math.round(100 - missing / h.length * 100) + '% of the area');
    for (let pass = 0; missing && pass < 400; pass++) {
      const src = h.slice();
      missing = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (src[k] === src[k]) continue;
        let sum = 0, c = 0;
        if (i > 0 && src[k - 1] === src[k - 1]) { sum += src[k - 1]; c++; }
        if (i < n - 1 && src[k + 1] === src[k + 1]) { sum += src[k + 1]; c++; }
        if (j > 0 && src[k - n] === src[k - n]) { sum += src[k - n]; c++; }
        if (j < n - 1 && src[k + n] === src[k + n]) { sum += src[k + n]; c++; }
        if (c) h[k] = sum / c; else missing++;
      }
    }
    for (let b = 0; b < (blur || 0); b++) {
      const src = h.slice();
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        h[k] = (src[k] * 4 + src[k - 1] + src[k + 1] + src[k - n] + src[k + n]) / 8;
      }
    }
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < h.length; i++) { if (h[i] < min) min = h[i]; if (h[i] > max) max = h[i]; }
    for (let i = 0; i < h.length; i++) h[i] -= min;
    const t = makeTerrain(h, n, R, G);
    t.base = min; t.relief = max - min;
    return t;
  }

  // Cesium quantized-mesh tile -> { u, v (0..1 across the tile), h (metres), idx }
  function decodeQM(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 96) throw new Error('terrain tile too short');
    const minH = dv.getFloat32(24, true), maxH = dv.getFloat32(28, true), n = dv.getUint32(88, true);
    let o = 92;
    if (!n || o + 6 * n + 4 > dv.byteLength) throw new Error('terrain tile has a bad vertex count');
    const u = new Float64Array(n), v = new Float64Array(n), h = new Float64Array(n);
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const zu = dv.getUint16(o + 2 * i, true), zv = dv.getUint16(o + 2 * n + 2 * i, true), zh = dv.getUint16(o + 4 * n + 2 * i, true);
      a += (zu >> 1) ^ -(zu & 1); b += (zv >> 1) ^ -(zv & 1); c += (zh >> 1) ^ -(zh & 1);
      u[i] = a / 32767; v[i] = b / 32767; h[i] = minH + c / 32767 * (maxH - minH);
    }
    o += 6 * n;
    const big = n > 65536;
    if (big && o % 4) o += 4 - o % 4;
    const tc = dv.getUint32(o, true); o += 4;
    if (o + tc * 3 * (big ? 4 : 2) > dv.byteLength) throw new Error('terrain tile has a bad triangle count');
    const idx = new Uint32Array(tc * 3);
    let hi = 0;
    for (let i = 0; i < tc * 3; i++) {
      const code = big ? dv.getUint32(o + 4 * i, true) : dv.getUint16(o + 2 * i, true);
      idx[i] = hi - code; if (code === 0) hi++;
    }
    return { u: u, v: v, h: h, idx: idx };
  }

  // Tiles of the global-geodetic TMS scheme (two tiles at zoom 0, y counted from the south).
  function qmTileList(lat, lon, R, z) {
    const sc = scale(lat), size = 180 / Math.pow(2, z), dLat = R / sc[1], dLon = R / sc[0], out = [];
    for (let x = Math.floor((lon - dLon + 180) / size); x <= Math.floor((lon + dLon + 180) / size); x++)
      for (let y = Math.floor((lat - dLat + 90) / size); y <= Math.floor((lat + dLat + 90) / size); y++) out.push({ z: z, x: x, y: y });
    return out;
  }
  function qmAddTriangles(tris, dec, t, lat0, lon0) {
    const size = 180 / Math.pow(2, t.z), west = -180 + t.x * size, south = -90 + t.y * size;
    const sc = scale(lat0), kx = sc[0], kz = sc[1];
    for (let i = 0; i < dec.idx.length; i++) {
      const k = dec.idx[i];
      tris.push((west + dec.u[k] * size - lon0) * kx, -(south + dec.v[k] * size - lat0) * kz, dec.h[k]);
    }
  }

  function clipPoly(poly, f) { // keeps the part where f(p) <= 0
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], fp = f(p), fq = f(q);
      if (fp <= 0) out.push(p);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  }

  // Cuts every flat triangle along the terrain's grid lines and diagonals, so each piece lies exactly on one terrain facet.
  function drapeFlat(pos, col, t) {
    const op = [], oc = [], R = t.R, G = t.G, n = t.n, H = t.heightAt;
    for (let k = 0; k < pos.length; k += 9) {
      const tri = [[pos[k], pos[k + 2]], [pos[k + 3], pos[k + 5]], [pos[k + 6], pos[k + 8]]];
      const off = pos[k + 1], r = col[k], g = col[k + 1], b = col[k + 2];
      const i0 = Math.max(0, Math.floor((Math.min(tri[0][0], tri[1][0], tri[2][0]) + R) / G));
      const i1 = Math.min(n - 2, Math.floor((Math.max(tri[0][0], tri[1][0], tri[2][0]) + R) / G));
      for (let i = i0; i <= i1; i++) {
        const xa = -R + i * G, xb = xa + G;
        const strip = clipPoly(clipPoly(tri, p => xa - p[0]), p => p[0] - xb);
        if (strip.length < 3) continue;
        let zmin = Infinity, zmax = -Infinity;
        for (const p of strip) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
        const j0 = Math.max(0, Math.floor((zmin + R) / G)), j1 = Math.min(n - 2, Math.floor((zmax + R) / G));
        for (let j = j0; j <= j1; j++) {
          const za = -R + j * G, zb = za + G;
          const cell = clipPoly(clipPoly(strip, p => za - p[1]), p => p[1] - zb);
          if (cell.length < 3) continue;
          const halves = [clipPoly(cell, p => (p[0] - xa) + (p[1] - za) - G), clipPoly(cell, p => G - (p[0] - xa) - (p[1] - za))];
          for (const piece of halves) {
            for (let m = 1; m < piece.length - 1; m++) {
              for (const q of [piece[0], piece[m], piece[m + 1]]) { op.push(q[0], H(q[0], q[1]) + off, q[1]); oc.push(r, g, b); }
            }
          }
        }
      }
    }
    return { pos: op, col: oc };
  }

  function resample(pts, step) {
    const o = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 1; k <= steps; k++) o.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
    }
    return o;
  }

  // Levels the ground along every road, like a road builder would: each road gets a smooth height profile
  // along its centre line, and the terrain within a few metres is pulled to that height. Bridges are left out.
  function burnRoads(w, t) {
    const G = t.G, R = t.R, n = t.n, h = t.h, H = t.heightAt;
    const ends = []; // bridge end points: the road arriving there must not sag toward the valley
    for (const r of w.roads) if (r.bridge) { ends.push(r.pts[0], r.pts[r.pts.length - 1]); }
    const atBridge = p => ends.some(e => Math.hypot(e[0] - p[0], e[1] - p[1]) < 3);
    const samples = [];
    for (const r of w.roads) {
      if (r.bridge || r.pts.length < 2) continue;
      const P = resample(r.pts, 6), m = P.length, hs = P.map(p => H(p[0], p[1]));
      const lift = (from, dir) => { // hold the last 18 m before a bridge at least as high as the road further back
        let top = hs[from];
        for (let k = 0; k < 4 && from + dir * k >= 0 && from + dir * k < m; k++) top = Math.max(top, hs[from + dir * k]);
        for (let k = 0; k < 3 && from + dir * k >= 0 && from + dir * k < m; k++) hs[from + dir * k] = top;
      };
      if (atBridge(P[0])) lift(0, 1);
      if (atBridge(P[m - 1])) lift(m - 1, -1);
      for (let pass = 0; pass < 8 && m > 2; pass++) {
        let prev = hs[0];
        for (let i = 1; i < m - 1; i++) { const cur = hs[i]; hs[i] = (prev + 2 * cur + hs[i + 1]) / 4; prev = cur; }
      }
      for (let i = 0; i < m; i++) samples.push([P[i][0], P[i][1], hs[i], r.w / 2]);
    }
    const sum = new Float32Array(n * n), ws = new Float32Array(n * n), blend = new Float32Array(n * n);
    for (const q of samples) {
      const full = q[3] + 8, reach = q[3] + 20;
      const i0 = Math.max(0, Math.ceil((q[0] - reach + R) / G)), i1 = Math.min(n - 1, Math.floor((q[0] + reach + R) / G));
      const j0 = Math.max(0, Math.ceil((q[1] - reach + R) / G)), j1 = Math.min(n - 1, Math.floor((q[1] + reach + R) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(-R + i * G - q[0], -R + j * G - q[1]);
        if (d > reach) continue;
        const k = j * n + i, wgt = 1 / (d * d + 4), b = d <= full ? 1 : (reach - d) / (reach - full);
        sum[k] += wgt * q[2]; ws[k] += wgt; if (b > blend[k]) blend[k] = b;
      }
    }
    for (let k = 0; k < h.length; k++) if (ws[k] > 0) h[k] += blend[k] * (sum[k] / ws[k] - h[k]);
  }

  // Puts the world on the terrain: levels the roads, stores the height lookup and gives bridges a deck
  // that spans between their two ends.
  function applyTerrain(w, t) {
    w.terrain = t; w.heightAt = t.heightAt;
    const H = t.heightAt;
    // a short piece of road between two bridge pieces (on a pier, say) belongs to the bridge
    const bend = [];
    for (const r of w.roads) if (r.bridge && r.pts.length > 1) bend.push(r.pts[0], r.pts[r.pts.length - 1]);
    const touches = p => bend.some(e => Math.hypot(e[0] - p[0], e[1] - p[1]) < 3);
    for (const r of w.roads) {
      if (r.bridge || r.pts.length < 2 || !bend.length) continue;
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      if (len < 80 && touches(r.pts[0]) && touches(r.pts[r.pts.length - 1])) r.bridge = true;
    }
    const br = w.roads.filter(r => r.bridge && r.pts.length > 1);
    for (const r of br) r.pts = resample(r.pts, 8); // short steps, so the deck can follow the ground where it touches it
    burnRoads(w, t);
    w.bridges = br.length;
    if (!br.length) return w;
    const nodes = new Map();
    const node = p => {
      const key = Math.round(p[0]) + ',' + Math.round(p[1]);
      let nd = nodes.get(key);
      if (!nd) { nd = { p: p, nb: [], h: H(p[0], p[1]), fixed: false, ends: 0 }; nodes.set(key, nd); }
      return nd;
    };
    const link = (a, b, len) => { if (a === b) return; len = Math.max(0.1, len); a.nb.push([b, 1 / len]); b.nb.push([a, 1 / len]); };
    for (const r of br) {
      r.nodes = r.pts.map(node);
      for (let i = 1; i < r.pts.length; i++) link(r.nodes[i - 1], r.nodes[i], Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    }
    // a loose end that lies on another bridge piece (map tiles overlap by up to 50 m) is joined to it instead of touching down
    for (const r of br) for (const end of [r.nodes[0], r.nodes[r.nodes.length - 1]]) {
      if (end.nb.length !== 1) continue;
      let best = null, bd = 3;
      for (const o of br) {
        if (o === r) continue;
        for (let i = 0; i < o.pts.length - 1; i++) {
          const a = o.pts[i], b = o.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
          let tt = L ? ((end.p[0] - a[0]) * dx + (end.p[1] - a[1]) * dz) / L : 0;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const d = Math.hypot(end.p[0] - a[0] - dx * tt, end.p[1] - a[1] - dz * tt);
          if (d < bd) { bd = d; best = [o.nodes[i], o.nodes[i + 1]]; }
        }
      }
      if (best) for (const nd of best) link(end, nd, Math.hypot(nd.p[0] - end.p[0], nd.p[1] - end.p[1]));
    }
    const all = Array.from(nodes.values());
    for (const r of br) { // where a bridge lands, use the higher of the ground at its end and just beyond it
      const m = r.pts.length;
      for (const e of [[r.nodes[0], r.pts[0], r.pts[1]], [r.nodes[m - 1], r.pts[m - 1], r.pts[m - 2]]]) {
        const nd = e[0];
        if (nd.nb.length !== 1) continue;
        const dx = e[1][0] - e[2][0], dz = e[1][1] - e[2][1], L = Math.hypot(dx, dz) || 1;
        for (const k of [6, 12]) nd.h = Math.max(nd.h, H(e[1][0] + dx / L * k, e[1][1] + dz / L * k));
        nd.fixed = true;
      }
    }
    const iters = Math.min(40000, 200 + all.length * all.length * 2);
    for (let it = 0; it < iters; it++) {
      let move = 0;
      for (const nd of all) {
        if (nd.fixed || !nd.nb.length) continue;
        let sum = 0, ws = 0;
        for (const e of nd.nb) { sum += e[0].h * e[1]; ws += e[1]; }
        const v = sum / ws; move = Math.max(move, Math.abs(v - nd.h)); nd.h = v;
      }
      if (move < 0.0001) break;
    }
    for (const r of br) { r.ys = r.nodes.map(nd => Math.max(nd.h, H(nd.p[0], nd.p[1]) + 0.1)); delete r.nodes; }
    return w;
  }

  const PALETTE = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fff1e6', '#ffadad', '#f1e3d3'].map(rgb);

  function buildBuildings(w) {
    const pos = [], nor = [], col = [], uv = [];
    for (const b of w.buildings) {
      let p = thin(b.pts, 200);
      if (p.length < 3) continue;
      if (polyArea(p) > 0) p = p.slice().reverse(); // walk clockwise so wall normals point outward
      const c = PALETTE[Math.abs(b.id) % PALETTE.length], n = p.length;
      let y0 = 0, h = b.h;
      if (w.heightAt) { // stand on the slope: walls reach down to the lowest corner
        let mn = Infinity, sum = 0;
        for (const q of p) { const g = w.heightAt(q[0], q[1]); if (g < mn) mn = g; sum += g; }
        y0 = mn - 0.4; h = sum / n + b.h;
      }
      let u = 0;
      for (let i = 0; i < n; i++) {
        const A = p[i], B = p[(i + 1) % n];
        const dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = -dz / len, nz = dx / len, u1 = u + len / 4, v1 = (h - y0) / 3.5;
        pos.push(A[0], y0, A[1], B[0], y0, B[1], B[0], h, B[1], A[0], y0, A[1], B[0], h, B[1], A[0], h, A[1]);
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
    if (!w.heightAt) w.heightAt = function () { return 0; };
    // Height the car stands on. On or under a bridge there are two answers; take the one nearest to where the car already is.
    w.groundAt = function (x, z, prev) {
      const g = w.heightAt(x, z);
      if (prev === undefined) return g;
      const l = rg.get(key(Math.floor(x / RC), Math.floor(z / RC)));
      if (!l) return g;
      let best = g, bd = Math.abs(g - prev);
      for (const s of l) {
        const ys = s.r.ys;
        if (!ys) continue;
        const a = s.r.pts[s.i], b = s.r.pts[s.i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
        let t = L ? ((x - a[0]) * dx + (z - a[1]) * dz) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) > s.r.w / 2 + 1.6) continue;
        const y = ys[s.i] + (ys[s.i + 1] - ys[s.i]) * t + 0.06, d = Math.abs(y - prev);
        if (d < bd) { bd = d; best = y; }
      }
      return best;
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
        if ((pass && r.kind !== 1) || r.bridge) continue;
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
    let roads = w.roads.filter(r => r.kind === 1 && !r.bridge);
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
      if (a.type === 'water' || a.type === 'land' || out.length > 600) continue;
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
    stepCar: stepCar, MAXV: MAXV, decodeMVT: decodeMVT, decodeQM: decodeQM, qmTileList: qmTileList, qmAddTriangles: qmAddTriangles, rasterTIN: rasterTIN,
    finishTerrain: finishTerrain, burnRoads: burnRoads, scale: scale, ecef: ecef, geodetic: geodetic, localFrame: localFrame,
    parseB3dm: parseB3dm, volumeNear: volumeNear, mul4: mul4, modelToLocal: modelToLocal, seatBuildings: seatBuildings, makeTerrain: makeTerrain, drapeFlat: drapeFlat, applyTerrain: applyTerrain, tileList: tileList, worldFromTiles: worldFromTiles
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GMA = api;
})(this);

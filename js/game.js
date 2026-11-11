/* Grand Martin Auto: rendering, input, sound and game flow. */
(function () {
  'use strict';
  const C = window.GMA;
  const $ = s => document.querySelector(s);
  const HALF = 550; // the loaded map is a square of 2 * HALF metres

  // Bern only for now. Each spot is the centre of a loaded square of about 1.1 km.
  const CITIES = [
    { name: 'Altstadt', lat: 46.9480, lon: 7.4474 },
    { name: 'Bärenpark', lat: 46.9478, lon: 7.4590 },
    { name: 'Bahnhof', lat: 46.9488, lon: 7.4391 },
    { name: 'Kirchenfeld', lat: 46.9433, lon: 7.4495 },
    { name: 'Wankdorf', lat: 46.9630, lon: 7.4650 }
  ];
  const CARS = [
    { id: 'red', name: 'Rocket', c: '#ff3b3b' }, { id: 'yellow', name: 'Banana', c: '#ffd23f' },
    { id: 'blue', name: 'Splash', c: '#2f8bff' }, { id: 'green', name: 'Frog', c: '#2ee6a6' },
    { id: 'pink', name: 'Bubble', c: '#ff5fa8' }, { id: 'white', name: 'Ghost', c: '#f4f4fb' }
  ];
  // Street map sources, tried in order. Both use the OpenMapTiles layout.
  const MAPS = [
    { name: 'swisstopo', json: 'https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/tiles.json',
      tiles: 'https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/{z}/{x}/{y}.pbf' },
    { name: 'OpenFreeMap', json: 'https://tiles.openfreemap.org/planet',
      tiles: 'https://tiles.openfreemap.org/planet/20251217_001001_pt/{z}/{x}/{y}.pbf' }
  ];
  const SWISS_BUILDINGS = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json';
  const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/';
  const SWISS_TERRAIN = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/';
  const CHEERS = ['NICE!', 'ZOOM!', 'GOT IT!', 'YES!', 'WOW!', 'SUPER!'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage is optional */ } }
  };

  // ---------- state ----------
  let renderer, scene, camera, ground = null, worldGroup = null, car = null, wheels = [], frontPivots = [];
  let world = null, s = null, stars = [], running = false, paused = false, last = 0, clock = 0;
  let level = 1, need = 5, got = 0, score = 0, best = +store.get('gma-best', 0) || 0;
  let carColor = store.get('gma-car', 'red'), soundOn = store.get('gma-sound', '1') === '1';
  let miniBase = null, miniScale = 1, edgeToastAt = -10, lastStreet = null, starGeo = null, winTex = null;
  const input = { up: 0, down: 0, left: 0, right: 0, brake: 0 };
  const rnd = C.mulberry32((Date.now() & 0xffffff) || 1);

  // ---------- menu ----------
  function carSvg(c) {
    return '<svg viewBox="0 0 64 34" aria-hidden="true"><path d="M4 22c0-5 3-7 8-8l6-8c1-2 3-3 6-3h14c3 0 5 1 7 3l6 8c5 1 9 3 9 8v3H4z" fill="' + c +
      '" stroke="#0c0830" stroke-width="3" stroke-linejoin="round"/><path d="M21 7h9v7H16zM34 7h8l5 7H34z" fill="#bfeaff" stroke="#0c0830" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="18" cy="26" r="6" fill="#0c0830"/><circle cx="18" cy="26" r="2.4" fill="#fff8e7"/><circle cx="47" cy="26" r="6" fill="#0c0830"/><circle cx="47" cy="26" r="2.4" fill="#fff8e7"/></svg>';
  }
  function buildMenu() {
    const cars = $('#cars');
    CARS.forEach(o => {
      const d = document.createElement('div');
      d.className = 'car-opt';
      d.innerHTML = '<input type="radio" name="car" id="car-' + o.id + '" value="' + o.id + '"><label for="car-' + o.id + '">' + carSvg(o.c) + o.name + '</label>';
      const inp = d.querySelector('input');
      inp.checked = o.id === carColor;
      inp.addEventListener('change', () => { carColor = o.id; store.set('gma-car', o.id); });
      cars.appendChild(d);
    });
    if (!CARS.some(o => o.id === carColor)) { carColor = 'red'; $('#car-red').checked = true; }
    const cities = $('#cities');
    CITIES.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn ' + ['', 'sky', 'mint', 'ghost'][i % 4]; b.textContent = c.name;
      b.addEventListener('click', () => go(c));
      cities.appendChild(b);
    });
    const p = document.createElement('button');
    p.type = 'button'; p.className = 'btn pink'; p.textContent = 'Practice Town';
    p.addEventListener('click', () => go({ practice: true, name: 'Practice Town' }));
    cities.appendChild(p);
    showBest();
  }
  function showBest() {
    const b = $('#best');
    b.hidden = !best;
    b.textContent = 'Best score: ' + best;
  }

  // ---------- map data ----------
  async function fetchJSON(url, opt, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opt || {}));
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function fetchTiles(src, lat, lon) {
    let tpl = src.tiles, zoom = 14;
    try {
      const tj = await fetchJSON(src.json, null, 8000);
      if (tj && tj.tiles && tj.tiles[0]) tpl = tj.tiles[0];
      if (tj && tj.maxzoom < 14) zoom = tj.maxzoom;
    } catch (e) { /* use the known tile address */ }
    const tiles = await Promise.all(C.tileList(lat, lon, HALF, zoom).map(async t => {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch(tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y), { signal: ctl.signal });
        if (r.status === 404 || r.status === 204) return Object.assign({ layers: {} }, t);
        if (!r.ok) throw new Error('map tile answered ' + r.status);
        const buf = new Uint8Array(await gunzipIfNeeded(await r.arrayBuffer()));
        return Object.assign({ layers: buf.length ? C.decodeMVT(buf) : {} }, t);
      } finally { clearTimeout(timer); }
    }));
    return C.worldFromTiles(tiles, lat, lon, HALF);
  }
  async function loadWorld(lat, lon) {
    const notes = [];
    let empty = false;
    for (const src of MAPS) {
      try {
        const w = await fetchTiles(src, lat, lon);
        if (w.roads.length >= 4) {
          w.src = src.name + ' (' + w.roads.length + ' roads, ' + w.buildings.length + ' footprints)' + (notes.length ? ' after ' + notes.join('; ') : '');
          return w;
        }
        empty = true; notes.push(src.name + ' had only ' + w.roads.length + ' roads');
      } catch (e) { console.warn(src.name + ' tiles failed', e); notes.push(src.name + ' failed: ' + String((e && e.message) || e).slice(0, 80)); }
    }
    throw new Error(empty ? 'nostreets' : 'net');
  }

  // ---------- terrain (swisstopo, Switzerland only for now) ----------
  function inSwitzerland(lat, lon) { return lat > 45.8 && lat < 47.85 && lon > 5.9 && lon < 10.55; }
  async function gunzipIfNeeded(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0x1f && b[1] === 0x8b && window.DecompressionStream)
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return buf;
  }
  async function swissTerrain(lat, lon) {
    const R = HALF + 310, G = 10;
    let base = SWISS_TERRAIN, tpl = '{z}/{x}/{y}.terrain';
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(SWISS_TERRAIN + 'layer.json', { signal: ctl.signal });
        const lj = await r.json();
        if (lj && lj.tiles && lj.tiles[0]) { tpl = String(lj.tiles[0]).replace('{version}', lj.version || ''); base = new URL('.', r.url).href; }
      } finally { clearTimeout(timer); }
    } catch (e) { /* use the documented tile address */ }
    let lastErr = null;
    for (const z of [15, 14]) {
      try {
        const tris = [], list = C.qmTileList(lat, lon, R, z);
        await Promise.all(list.map(async t => {
          const url = new URL(tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y), base).href;
          const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
          try {
            const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9,*/*;q=0.01' } });
            if (!r.ok) throw new Error('terrain tile ' + t.z + '/' + t.x + '/' + t.y + ' answered ' + r.status);
            C.qmAddTriangles(tris, C.decodeQM(await gunzipIfNeeded(await r.arrayBuffer())), t, lat, lon);
          } finally { clearTimeout(timer); }
        }));
        const ras = C.rasterTIN(tris, R, G), ter = C.finishTerrain(ras.h, ras.n, R, G, 1);
        ter.info = 'swisstopo, zoom ' + z + ', ' + list.length + ' tiles, ' + Math.round(ter.relief) + ' m of height difference';
        return ter;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no terrain');
  }
  // Never fails: without terrain the city is simply flat. The reason is kept for the pause screen.
  async function loadTerrain(w, lat, lon) {
    if (!inSwitzerland(lat, lon)) { w.terrainInfo = 'flat (terrain is only loaded in Switzerland)'; return; }
    try {
      const ter = await swissTerrain(lat, lon);
      C.applyTerrain(w, ter);
      w.terrainInfo = ter.info;
    } catch (e) {
      console.warn('terrain failed', e);
      w.terrainInfo = 'flat, swisstopo terrain failed: ' + String((e && e.message) || e).slice(0, 120);
    }
  }

  // ---------- swisstopo building models (3D Tiles) ----------
  async function loadModels(w, lat, lon) {
    const note = { tilesets: 0, tiles: 0, meshes: 0, verts: 0, all: 0 };
    w.models = null;
    let gaveUp = false;
    try {
      if (!THREE.GLTFLoader || !THREE.DRACOLoader) throw new Error('the model loader scripts did not load');
      const job = (async () => {
      const box = { lat: lat, lon: lon, R: HALF + 150 }, contents = [];
      const readSet = async (url, T, refine, depth) => {
        if (depth > 8 || note.tilesets >= 60) return;
        note.tilesets++;
        const r = await fetch(url);
        if (!r.ok) throw new Error('tileset answered ' + r.status);
        const j = await r.json(), base = r.url || url;
        if (j.asset && j.asset.gltfUpAxis) note.upAxis = j.asset.gltfUpAxis;
        const pending = [];
        const visit = (t, T, refine) => {
          if (!t) return;
          const TT = t.transform ? (T ? C.mul4(T, t.transform) : t.transform) : T;
          if (!C.volumeNear(t.boundingVolume, TT, box)) return;
          const ref = String(t.refine || refine || 'REPLACE').toUpperCase(), kids = t.children || [];
          const c = t.content && (t.content.uri || t.content.url);
          if (c) {
            const u = new URL(c, base).href;
            if (/\.json(\?|$)/i.test(c)) pending.push(readSet(u, TT, ref, depth + 1));
            else if (ref === 'ADD' || !kids.length) contents.push({ url: u, T: TT });
          }
          note.refine = ref;
          for (const k of kids) visit(k, TT, ref);
        };
        visit(j.root, T, refine);
        await Promise.all(pending);
      };
      await readSet(SWISS_BUILDINGS, null, null, 0);
      if (!contents.length) throw new Error('no building tiles found for this area');
      if (contents.length > 400) contents.length = 400;
      note.tiles = contents.length;
      note.first = contents[0].url.split('/').slice(-3).join('/');

      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath(DRACO_PATH);
      const loader = new THREE.GLTFLoader();
      loader.setDRACOLoader(draco);
      const parse = glb => new Promise((res, rej) => loader.parse(glb, '', res, rej));
      const v = new THREE.Vector3(), loaded = [];
      let failed = 0, lastErr = '';
      const one = async c => {
        try {
          const r = await fetch(c.url);
          if (!r.ok) throw new Error('tile answered ' + r.status);
          const b = C.parseB3dm(await gunzipIfNeeded(await r.arrayBuffer()));
          if (b.version !== 2) throw new Error('glTF version ' + b.version + ' is not supported');
          const g = await parse(b.glb), prims = [];
          const rtc = b.rtc || (g.parser && g.parser.json && g.parser.json.extensions && g.parser.json.extensions.CESIUM_RTC && g.parser.json.extensions.CESIUM_RTC.center) || null;
          g.scene.updateMatrixWorld(true);
          g.scene.traverse(o => {
            if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
            const pa = o.geometry.attributes.position, raw = new Float64Array(pa.count * 3);
            for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); raw[i * 3] = v.x; raw[i * 3 + 1] = v.y; raw[i * 3 + 2] = v.z; }
            const ba = o.geometry.attributes._batchid || o.geometry.attributes.batchid || null;
            prims.push({ raw: raw, batch: ba ? ba.array : null, index: o.geometry.index ? o.geometry.index.array : null });
            o.geometry.dispose();
          });
          if (prims.length) loaded.push({ prims: prims, rtc: rtc, T: c.T });
        } catch (e) { failed++; lastErr = String((e && e.message) || e).slice(0, 90); }
      };
      for (let i = 0; i < contents.length; i += 8) await Promise.all(contents.slice(i, i + 8).map(one));
      draco.dispose();
      if (!loaded.length) throw new Error('all ' + contents.length + ' building tiles failed: ' + lastErr);
      if (failed) note.failed = failed + ' tiles failed (' + lastErr + ')';

      // glTF says y is up; check against the data, since a wrong guess would tip every house on its side
      const frame = C.localFrame(lat, lon), range = [0, 0];
      for (const yUp of [1, 0]) for (const t of loaded.slice(0, 6)) for (const p of t.prims) {
        const r = C.modelToLocal(Float64Array.from(p.raw), !!yUp, t.rtc, t.T, frame);
        range[yUp] = Math.max(range[yUp], r[1] - r[0]);
      }
      const yUp = range[1] <= range[0];
      note.up = (yUp ? 'y' : 'z') + ' (height span ' + Math.round(range[1]) + ' vs ' + Math.round(range[0]) + ' m)';

      const ter = w.terrain, base = ter ? ter.base : 0, group = [], seats = [];
      let ids = 0, tileNo = 0;
      const keep = HALF + 130; // houses further out are hidden by the fog anyway
      for (const t of loaded) {
        tileNo++;
        t.prims = t.prims.map(p => {
          C.modelToLocal(p.raw, yUp, t.rtc, t.T, frame);
          note.all += p.raw.length / 3;
          const c = C.cropPrim({ pos: p.raw, batch: p.batch, index: p.index }, keep);
          p.raw = null;
          return c;
        }).filter(p => p.index.length);
        if (!t.prims.length) continue;
        if (t.prims.every(p => p.batch)) ids++;
        const st = C.seatBuildings(t.prims, w.heightAt || (() => 0), base);
        seats.push(st.median);
        for (const p of t.prims) { group.push({ pos: new Float32Array(p.pos), batch: p.batch, index: p.index, tile: tileNo }); note.meshes++; note.verts += p.pos.length / 3; }
        t.prims = null;
      }
      if (!group.length) throw new Error('the building tiles held no houses for this area');
      seats.sort((a, b) => a - b);
      note.seat = (ids ? 'each house set on the ground' : 'no house ids, true heights used') + ', typical shift ' + Math.round(seats[seats.length >> 1] + base) + ' m';
      if (gaveUp) return;
      w.models = group;
      w.modelInfo = 'swisstopo 3D, ' + note.tiles + ' tiles (' + note.refine + ', first ' + note.first + '), ' + note.meshes + ' meshes, ' +
        Math.round(note.verts / 1000) + 'k of ' + Math.round(note.all / 1000) + 'k points kept, up axis ' + note.up + ', ' + note.seat + (note.failed ? ', ' + note.failed : '');
      })();
      job.catch(() => {});
      await Promise.race([job, new Promise((res, rej) => setTimeout(() => rej(new Error('took longer than 75 seconds')), 75000))]);
    } catch (e) {
      gaveUp = true;
      console.warn('building models failed', e);
      w.modelInfo = 'simple blocks, swisstopo models failed after ' + note.tilesets + ' tileset files and ' + note.tiles + ' tiles: ' + String((e && e.message) || e).slice(0, 140);
    }
  }

  function showLoading(title, text) {
    $('#load-title').textContent = title; $('#load-text').textContent = text;
    $('#load-actions').hidden = true; $('#load-wheel').style.display = '';
    $('#loading').hidden = false;
  }
  function showError(title, text) {
    $('#load-title').textContent = title; $('#load-text').textContent = text;
    $('#load-actions').hidden = false; $('#load-wheel').style.display = 'none';
    $('#loading').hidden = false;
  }

  let busy = false;
  async function go(place) {
    if (busy) return;
    if (!window.THREE || !initThree()) {
      showError('No 3D engine', 'The 3D engine did not load. Check the internet connection and reload the page.');
      return;
    }
    busy = true;
    initAudio();
    try {
      let w;
      if (place.practice) {
        showLoading('Practice Town', 'Building a town to practise in');
        w = C.practiceTown();
        if (location.hash === '#terrain-test') { // practice streets on Bern's real hills, with Bern's real houses
          await loadTerrain(w, 46.9480, 7.4474);
          await loadModels(w, 46.9480, 7.4474);
        }
      } else {
        showLoading(place.name, 'Fetching the real streets and buildings');
        w = await loadWorld(place.lat, place.lon);
        $('#load-text').textContent = 'Fetching the hills';
        await loadTerrain(w, place.lat, place.lon);
        $('#load-text').textContent = 'Fetching the houses';
        await loadModels(w, place.lat, place.lon);
        $('#load-text').textContent = 'Building the city';
        await new Promise(r => setTimeout(r, 30));
        w.name = 'Bern, ' + place.name;
      }
      C.indexWorld(w);
      buildWorld(w);
      startGame(w);
      $('#loading').hidden = true;
    } catch (e) {
      const m = e && e.message;
      if (m === 'nostreets') showError('No streets there', 'That spot has no roads to drive on. Try another place.');
      else if (m === 'net') showError('Map did not load', 'The map server did not answer. Check the internet connection and try again, or drive in Practice Town.');
      else { console.error(e); showError('Something broke', 'The city could not be built. Try another place.'); }
    } finally { busy = false; }
  }

  // ---------- three.js ----------
  function initThree() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: $('#view'), antialias: true, powerPreference: 'high-performance' });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fdcff);
    scene.fog = new THREE.Fog(0x9fdcff, 240, 840);
    camera = new THREE.PerspectiveCamera(62, 1, 1, 900);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a98c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.65);
    sun.position.set(0.5, 1, 0.35);
    scene.add(sun);
    ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshBasicMaterial({ color: 0xe9dfc8 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    // puffy clouds
    const cg = new THREE.SphereGeometry(1, 10, 8), cm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const cr = C.mulberry32(11);
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(cg, cm), r = 14 + cr() * 14;
        m.scale.set(r * 1.5, r * 0.7, r); m.position.set((k - 1.5) * 20, cr() * 6, cr() * 12);
        g.add(m);
      }
      g.position.set((cr() - 0.5) * 1400, 170 + cr() * 80, (cr() - 0.5) * 1400);
      scene.add(g);
    }
    // window texture for building walls
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#566a9c'; x.fillRect(18, 12, 28, 34);
    x.fillStyle = '#8fb4e6'; x.fillRect(18, 12, 28, 12);
    winTex = new THREE.CanvasTexture(cv);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    // star shape
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.62 : 1.5;
      if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    sh.closePath();
    starGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false });
    starGeo.translate(0, 0, -0.25);
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    requestAnimationFrame(frame);
    return true;
  }
  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 80 : 62;
    camera.updateProjectionMatrix();
  }

  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry && o.geometry !== starGeo) o.geometry.dispose(); });
    scene.remove(g);
  }

  function buildWorld(w) {
    if (worldGroup) disposeGroup(worldGroup);
    worldGroup = new THREE.Group();
    const ter = w.terrain || null;
    ground.position.y = ter ? -0.6 : 0;
    if (ter) { // the hills themselves
      const n = ter.n, P = new Float32Array(n * n * 3), I = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        P[k * 3] = -ter.R + i * ter.G; P[k * 3 + 1] = ter.h[k]; P[k * 3 + 2] = -ter.R + j * ter.G;
      }
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        I.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      worldGroup.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xa9a28c })));
    }
    const raw = C.buildFlat(w), f = ter ? C.drapeFlat(raw.pos, raw.col, ter) : raw;
    const flatMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    if (f.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(f.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(f.col, 3));
      worldGroup.add(new THREE.Mesh(g, flatMat));
    }
    if (raw.dpos.length) { // bridge decks
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(raw.dpos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(raw.dcol, 3));
      worldGroup.add(new THREE.Mesh(g, flatMat));
    }
    let housesDrawn = false;
    if (w.models && w.models.length) {
      try { worldGroup.add(modelMeshes(w.models)); housesDrawn = true; }
      catch (e) { console.warn('drawing the building models failed', e); w.modelInfo = 'simple blocks, drawing the swisstopo models failed: ' + String((e && e.message) || e).slice(0, 120); }
      w.models = null; // the meshes own the data now
    }
    if (!housesDrawn) {
      const b = C.buildBuildings(w);
      if (b.pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        worldGroup.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex, side: THREE.DoubleSide })));
      }
    }
    const trees = C.placeTrees(w, C.mulberry32(3));
    if (trees.length) {
      const top = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6, 7), new THREE.MeshLambertMaterial({ color: 0x35b455 }), trees.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x8a5a3c }), trees.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      trees.forEach((t, i) => {
        sc.set(t[2], t[2], t[2]);
        const gy = w.heightAt(t[0], t[1]);
        p.set(t[0], gy + 5 * t[2], t[1]); m.compose(p, q, sc); top.setMatrixAt(i, m);
        p.set(t[0], gy + 1.2 * t[2], t[1]); m.compose(p, q, sc); trunk.setMatrixAt(i, m);
      });
      top.instanceMatrix.needsUpdate = true; trunk.instanceMatrix.needsUpdate = true;
      top.frustumCulled = false; trunk.frustumCulled = false;
      worldGroup.add(top, trunk);
    }
    scene.add(worldGroup);
    buildMini(w);
  }

  // Real building models: sandstone walls coloured per house, clay roofs.
  function modelMeshes(models) {
    const WALLS = [[237, 224, 194], [222, 209, 179], [245, 235, 212], [209, 199, 173], [230, 214, 184], [217, 219, 204]];
    const ROOF = [189, 102, 69];
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000, side: THREE.DoubleSide });
    const group = new THREE.Group();
    for (const m of models) {
      const pos = m.pos, n = pos.length / 3, col = new Uint8Array(n * 3);
      // a mesh whose faces mostly point up is a roof
      let up = 0, all = 0;
      const tri = m.index ? m.index.length / 3 : n / 3;
      for (let t = 0; t < tri; t += 1 + Math.floor(tri / 3000)) {
        const a = (m.index ? m.index[t * 3] : t * 3) * 3, b = (m.index ? m.index[t * 3 + 1] : t * 3 + 1) * 3, c = (m.index ? m.index[t * 3 + 2] : t * 3 + 2) * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
        all += len; if (len && Math.abs(ny) / len > 0.35) up += len;
      }
      const roof = all > 0 && up / all > 0.6;
      for (let i = 0; i < n; i++) {
        // ids arrive as floats and are not always whole or positive, so they are tidied before picking a colour
        const c = roof ? ROOF : WALLS[Math.abs(((m.batch && Math.round(m.batch[i])) || 0) * 7 + m.tile * 3) % WALLS.length];
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
      group.add(new THREE.Mesh(g, mat));
    }
    return group;
  }

  function makeCar(hex) {
    const g = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color: hex });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fe0ff });
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
    box(1.9, 0.55, 4.3, paint, 0, 0.68, 0);
    box(1.66, 0.55, 2.0, glass, 0, 1.2, -0.35);
    box(1.72, 0.12, 2.1, paint, 0, 1.52, -0.35);
    box(1.96, 0.22, 0.3, dark, 0, 0.5, 2.15);
    box(1.96, 0.22, 0.3, dark, 0, 0.5, -2.15);
    box(1.8, 0.1, 0.5, paint, 0, 1.3, -2.05); // spoiler
    box(0.12, 0.35, 0.12, dark, 0.7, 1.1, -2.05); box(0.12, 0.35, 0.12, dark, -0.7, 1.1, -2.05);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6c0 }), tail = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    box(0.4, 0.2, 0.08, lamp, 0.62, 0.78, 2.16); box(0.4, 0.2, 0.08, lamp, -0.62, 0.78, 2.16);
    box(0.4, 0.18, 0.08, tail, 0.62, 0.78, -2.16); box(0.4, 0.18, 0.08, tail, -0.62, 0.78, -2.16);
    const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14);
    wg.rotateZ(Math.PI / 2);
    const hub = new THREE.BoxGeometry(0.36, 0.5, 0.14), hubMat = new THREE.MeshLambertMaterial({ color: 0xfff8e7 });
    wheels = []; frontPivots = [];
    [[0.98, 1.35], [-0.98, 1.35], [0.98, -1.35], [-0.98, -1.35]].forEach((p, i) => {
      const piv = new THREE.Group();
      piv.position.set(p[0], 0.42, p[1]);
      const wh = new THREE.Mesh(wg, dark);
      wh.add(new THREE.Mesh(hub, hubMat));
      piv.add(wh); g.add(piv); wheels.push(wh);
      if (i < 2) frontPivots.push(piv);
    });
    return g;
  }

  function clearStars() {
    stars.forEach(st => scene.remove(st.obj));
    stars = [];
  }
  function addStars(n) {
    const pts = C.placeStars(world, n, s.x, s.z, rnd, stars);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x9a6a00, side: THREE.DoubleSide });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.28, depthWrite: false, fog: false });
    pts.forEach(p => {
      const o = new THREE.Group();
      const m = new THREE.Mesh(starGeo, mat);
      m.position.y = 2.6;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 90, 10, 1, true), beamMat);
      beam.position.y = 45;
      o.add(m, beam);
      o.position.set(p.x, world.heightAt(p.x, p.z), p.z);
      scene.add(o);
      stars.push({ x: p.x, z: p.z, obj: o, mesh: m });
    });
    return pts.length;
  }

  // ---------- game flow ----------
  function startGame(w) {
    world = w;
    const sp = C.pickSpawn(w);
    s = { x: sp.x, z: sp.z, h: sp.h, v: 0, steer: 0, onRoad: true, street: '', y: w.groundAt(sp.x, sp.z), vy: 0, pitch: 0, roll: 0 };
    if (car) scene.remove(car);
    car = makeCar((CARS.find(o => o.id === carColor) || CARS[0]).c);
    car.rotation.order = 'YXZ';
    scene.add(car);
    clearStars();
    level = 1; score = 0; lastStreet = null;
    startLevel();
    camera.position.set(s.x - Math.sin(s.h) * 30, s.y + 22, s.z - Math.cos(s.h) * 30);
    $('#sign-city').textContent = w.name;
    $('#dbg').textContent = 'Map: ' + (w.src || 'built in') + '. Terrain: ' + (w.terrainInfo || 'flat') + '. Bridges: ' + (w.bridges || 0) +
      '. Houses: ' + (w.modelInfo || 'simple blocks') + '.';
    $('#menu').hidden = true; $('#hud').hidden = false; $('#pause').hidden = true; $('#win').hidden = true;
    paused = false; running = true; last = 0;
    toast('FIND THE STARS!');
  }
  function startLevel() {
    need = Math.min(4 + level, 10); got = 0;
    need = addStars(need) || 0;
    updateScore();
  }
  function updateScore() {
    $('#stars-n').textContent = got + '/' + need;
    $('#level-n').textContent = level;
    $('#score-n').textContent = score;
    if (score > best) { best = score; store.set('gma-best', String(best)); }
  }
  function collect(i) {
    const st = stars[i];
    scene.remove(st.obj); stars.splice(i, 1);
    got++; score += 100;
    updateScore();
    const el = $('#stars');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    chime();
    if (got >= need) {
      score += 500; updateScore();
      $('#win-title').textContent = 'Level ' + level + ' done!';
      $('#win-score').textContent = '+500 bonus';
      $('#win-text').textContent = 'You found every star in ' + world.name + '. Score: ' + score;
      $('#win').hidden = false; paused = true; setEngine(0);
      confetti(); fanfare();
    } else toast(CHEERS[Math.floor(rnd() * CHEERS.length)]);
  }
  function nextLevel() {
    level++; $('#win').hidden = true; paused = false; last = 0;
    startLevel();
    toast('LEVEL ' + level);
  }
  function setPaused(p) {
    if (!running || !$('#win').hidden) return;
    paused = p; $('#pause').hidden = !p; last = 0;
    if (p) { setEngine(0); for (const k in input) input[k] = 0; }
  }
  function toMenu() {
    running = false; paused = false; setEngine(0);
    $('#pause').hidden = true; $('#win').hidden = true; $('#hud').hidden = true; $('#menu').hidden = false;
    showBest();
  }

  let toastT = 0;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 1100);
  }
  function confetti() {
    const box = $('#confetti'), cols = ['#ffd23f', '#ff3d7f', '#2ee6a6', '#45c8ff', '#fff8e7'];
    box.innerHTML = '';
    for (let i = 0; i < 60; i++) {
      const e = document.createElement('i');
      e.style.left = Math.random() * 100 + '%';
      e.style.background = cols[i % cols.length];
      e.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
      e.style.animationDelay = Math.random() * 0.5 + 's';
      box.appendChild(e);
    }
    setTimeout(() => { box.innerHTML = ''; }, 4200);
  }

  // ---------- minimap ----------
  function buildMini(w) {
    const N = 256, span = (w.half + 40) * 2;
    miniScale = N / span;
    miniBase = document.createElement('canvas');
    miniBase.width = miniBase.height = N;
    const x = miniBase.getContext('2d'), k = miniScale, o = N / 2;
    x.fillStyle = '#2a2d45'; x.fillRect(0, 0, N, N);
    for (const a of w.areas) {
      x.fillStyle = a.type === 'water' ? '#3f8fd0' : a.type === 'land' ? '#2a2d45' : '#3f7d4f';
      x.beginPath();
      a.pts.forEach((p, i) => { if (i) x.lineTo(p[0] * k + o, p[1] * k + o); else x.moveTo(p[0] * k + o, p[1] * k + o); });
      x.closePath(); x.fill();
    }
    x.lineCap = 'round'; x.lineJoin = 'round';
    const line = (pts, width, col) => {
      x.strokeStyle = col; x.lineWidth = width; x.beginPath();
      pts.forEach((p, i) => { if (i) x.lineTo(p[0] * k + o, p[1] * k + o); else x.moveTo(p[0] * k + o, p[1] * k + o); });
      x.stroke();
    };
    for (const r of w.rivers) line(r.pts, Math.max(1.5, r.w * k), '#3f8fd0');
    for (const r of w.roads) if (r.kind !== 1) line(r.pts, 1, '#676b8c');
    for (const r of w.roads) if (r.kind === 1) line(r.pts, Math.max(1.6, r.w * k), '#c9cbe6');
  }
  function drawMini() {
    const cv = $('#mini'), x = cv.getContext('2d'), k = miniScale, o = 128;
    x.drawImage(miniBase, 0, 0);
    x.fillStyle = '#ffd23f'; x.strokeStyle = '#0c0830'; x.lineWidth = 2;
    const pulse = 5 + Math.sin(clock * 5) * 1.2;
    for (const st of stars) { x.beginPath(); x.arc(st.x * k + o, st.z * k + o, pulse, 0, 6.3); x.fill(); x.stroke(); }
    x.save();
    x.translate(s.x * k + o, s.z * k + o); x.rotate(Math.PI - s.h);
    x.fillStyle = '#ff3d7f'; x.strokeStyle = '#ffffff'; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(0, -11); x.lineTo(8, 9); x.lineTo(0, 4); x.lineTo(-8, 9); x.closePath(); x.fill(); x.stroke();
    x.restore();
  }

  // ---------- frame ----------
  const camTarget = { x: 0, y: 0, z: 0 };
  function frame(t) {
    requestAnimationFrame(frame);
    if (!running) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    if (!paused) update(dt);
    renderer.render(scene, camera);
  }
  function update(dt) {
    clock += dt;
    const ev = C.stepCar(s, input, dt, world);
    if (ev.bump > 2) { bump(Math.min(1, ev.bump / 15)); if (ev.bump > 6) toast('BONK!'); }
    if (ev.edge && clock - edgeToastAt > 3) { edgeToastAt = clock; toast('TURN AROUND!'); }
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    // height: follow the ground, or fall when the ground drops away (driving off a bridge)
    const gy = world.groundAt(s.x, s.z, s.y);
    if (s.y - gy > 0.45) {
      s.vy -= 25 * dt; s.y += s.vy * dt;
      if (s.y <= gy) { if (s.vy < -7) { bump(0.9); toast('BOING!'); } s.y = gy; s.vy = 0; }
    } else {
      s.y = gy; s.vy = 0;
      const hf = world.groundAt(s.x + fx * 2, s.z + fz * 2, s.y), hb = world.groundAt(s.x - fx * 2, s.z - fz * 2, s.y);
      const hl = world.groundAt(s.x + fz * 0.95, s.z - fx * 0.95, s.y), hr = world.groundAt(s.x - fz * 0.95, s.z + fx * 0.95, s.y);
      const kk = Math.min(1, dt * 10);
      if (Math.abs(hf - hb) < 3) s.pitch += (Math.atan2(hf - hb, 4) - s.pitch) * kk;
      if (Math.abs(hl - hr) < 1.5) s.roll += (Math.atan2(hl - hr, 1.9) - s.roll) * kk;
    }
    car.position.set(s.x, s.y, s.z);
    car.rotation.set(-s.pitch, s.h, s.roll + s.steer * s.v * 0.004);
    const spin = s.v * dt / 0.42;
    wheels.forEach(w => { w.rotation.x += spin; });
    frontPivots.forEach(p => { p.rotation.y = -s.steer * 0.45; });

    const back = 9.5 + Math.abs(s.v) * 0.12;
    camTarget.x = s.x - fx * back; camTarget.y = s.y + 4.6 + Math.abs(s.v) * 0.04; camTarget.z = s.z - fz * back;
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.x += (camTarget.x - camera.position.x) * k;
    camera.position.y += (camTarget.y - camera.position.y) * k;
    camera.position.z += (camTarget.z - camera.position.z) * k;
    const floor = world.heightAt(camera.position.x, camera.position.z) + 1.5; // keep the camera out of the hillside
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(s.x + fx * 6, s.y + 1.4, s.z + fz * 6);

    let near = null, nd = Infinity;
    for (let i = stars.length - 1; i >= 0; i--) {
      const st = stars[i];
      st.mesh.rotation.y = clock * 2.2;
      st.mesh.position.y = 2.6 + Math.sin(clock * 3 + i) * 0.35;
      const d = Math.hypot(st.x - s.x, st.z - s.z);
      if (d < 4.2) { collect(i); if (paused) break; continue; }
      if (d < nd) { nd = d; near = st; }
    }
    if (near) {
      const dx = near.x - s.x, dz = near.z - s.z;
      const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
      $('#seek-arrow').style.transform = 'rotate(' + ang + 'rad)';
      $('#seek-dist').textContent = Math.round(nd / 5) * 5 + ' m';
    }
    const kmh = Math.abs(s.v) * 3.6;
    $('#needle').style.transform = 'rotate(' + (-120 + Math.min(100, kmh) / 100 * 240) + 'deg)';
    $('#kmh').textContent = Math.round(kmh);
    const street = s.street || (s.onRoad ? 'Street' : 'Off road');
    if (street !== lastStreet) { lastStreet = street; $('#sign-street').textContent = street; }
    drawMini();
    setEngine(Math.abs(s.v));
  }

  // ---------- sound ----------
  let ac = null, master = null, eng = null, engGain = null;
  function initAudio() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      master = ac.createGain(); master.gain.value = soundOn ? 0.6 : 0; master.connect(ac.destination);
      eng = ac.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 50;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      engGain = ac.createGain(); engGain.gain.value = 0;
      eng.connect(lp); lp.connect(engGain); engGain.connect(master); eng.start();
    } catch (e) { ac = null; }
  }
  function setEngine(v) {
    if (!ac) return;
    const on = running && !paused;
    engGain.gain.setTargetAtTime(on ? 0.05 + v * 0.003 : 0, ac.currentTime, 0.06);
    eng.frequency.setTargetAtTime(48 + v * 5.5, ac.currentTime, 0.06);
  }
  function tone(type, f, t0, dur, vol, f2) {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function horn() { tone('square', 415, 0, 0.32, 0.16); tone('square', 523, 0, 0.32, 0.16); }
  function chime() { tone('triangle', 880, 0, 0.18, 0.3); tone('triangle', 1175, 0.08, 0.18, 0.3); tone('triangle', 1568, 0.16, 0.3, 0.3); }
  function fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, i * 0.13, 0.2, 0.14)); }
  function bump(a) { tone('sine', 140, 0, 0.22, 0.5 * a + 0.1, 45); }
  function setSound(on) {
    soundOn = on; store.set('gma-sound', on ? '1' : '0');
    $('#btn-sound').textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
    if (master) master.gain.value = on ? 0.6 : 0;
  }

  // ---------- input ----------
  const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake' };
  function bindInput() {
    window.addEventListener('keydown', e => {
      if (!running) return;
      if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!paused); e.preventDefault(); return; }
      if (paused) return;
      if (e.code === 'KeyH') { if (!e.repeat) horn(); return; }
      const k = KEYS[e.code];
      if (k) { input[k] = 1; e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) input[k] = 0; });
    window.addEventListener('blur', () => { for (const k in input) input[k] = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused) setPaused(true); });
    document.querySelectorAll('#pad [data-key]').forEach(b => {
      const k = b.dataset.key;
      const on = e => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* not supported everywhere */ }
        b.classList.add('on');
        if (k === 'horn') horn(); else input[k] = 1;
      };
      const off = () => { b.classList.remove('on'); if (k !== 'horn') input[k] = 0; };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    const touchy = () => { document.body.classList.add('touch'); $('#keys').hidden = true; };
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) touchy();
    window.addEventListener('touchstart', touchy, { once: true, passive: true });
    $('#view').addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    $('#btn-pause').addEventListener('click', () => setPaused(true));
    $('#btn-resume').addEventListener('click', () => setPaused(false));
    $('#btn-newcity').addEventListener('click', toMenu);
    $('#btn-sound').addEventListener('click', () => setSound(!soundOn));
    $('#btn-next').addEventListener('click', nextLevel);
    $('#btn-back').addEventListener('click', () => { $('#loading').hidden = true; });
    $('#btn-practice').addEventListener('click', () => { $('#loading').hidden = true; go({ practice: true, name: 'Practice Town' }); });
  }

  C.dev = () => ({ scene: scene, camera: camera, renderer: renderer, car: s, world: world, stars: stars }); // for automated tests
  buildMenu();
  bindInput();
  setSound(soundOn);
})();

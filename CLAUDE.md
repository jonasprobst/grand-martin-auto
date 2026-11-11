# Grand Martin Auto

A 3D driving game for a child aged 6 to 9: drive a car around the real streets and hills of Bern and collect stars.
Live at https://jonasprobst.github.io/grand-martin-auto/ (GitHub Pages serves the `gh-pages` branch).

## Read first

- `docs/HANDOFF.md`: current state, what is verified, what is unverified, open issues, next steps.
- `docs/swisstopo-plan.md`: data sources and the plan for swisstopo data.

## Layout

- `index.html`: markup, all CSS, script tags. No build step.
- `js/core.js`: pure logic with no DOM and no three.js. Map-tile decoding, world building, terrain, bridges, geometry,
  car physics, building-model maths. Runs in Node.
- `js/game.js`: three.js rendering, network loading, input, sound, HUD, game flow.
- `tests/`: Node scripts for `core.js` and headless-Chrome checks.

## Rules for this project

- Publish by pushing the same commit to `main` and `gh-pages`: `git push origin main && git push origin main:gh-pages`.
- Keep `core.js` free of DOM and three.js so it stays testable in Node. Put new logic there when possible.
- Every network source must fail soft: the game falls back (flat ground, simple block houses, fallback map) and
  writes the reason into the pause-screen info line (`#dbg`). Keep that line accurate; it is the main debugging tool
  on the owner's phone.
- three.js is r128 (global build from cdnjs) with `examples/js` loaders from jsDelivr. Do not use APIs newer than r128.
- The player is a child on a phone or a computer: touch buttons and keyboard must both keep working.
- UI text is plain English, short, no emoji. Arcade look: tokens are in the `:root` block of `index.html`.
- Scope is Bern only, swisstopo data only (OpenFreeMap remains as a silent fallback for the street map).
- Credit "© swisstopo" in the menu footer.

## Tests

```
cd tests && for f in core-*.js; do node $f; done      # print values to compare by eye, no assertions
python3 tests/browser/menu_check.py                    # needs playwright and Chrome at /usr/bin/google-chrome
python3 tests/browser/terrain_check.py
```

The browser checks replace three.js with a stand-in, so they catch JavaScript errors but not rendering problems.
To see real rendering, the machine needs network access to `3d.geo.admin.ch`, `vectortiles.geo.admin.ch`,
`cdnjs.cloudflare.com` and `cdn.jsdelivr.net`.

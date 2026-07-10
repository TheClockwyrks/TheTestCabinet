# Sunfront — reference implementation

The authored, **correct** reference build of the Sunfront end-to-end test case: a
real-time **3D tug-of-war** for the browser. You spend a steadily ticking income on
**spawner structures** and **Solar Extractors** in a walled staging yard; every
**wave** each spawner stamps out its unit, and those units march across the sand
toward the enemy base, fighting whatever they meet — while a **fog of war** hides the
enemy's yard so you counter only what you see crossing the dune. See the case specs
under `../../specs/` for the authoritative design.

This is the reference implementation used to validate the case; it is built to the
same rules a real run must follow (no backend, no credentials, `npm ci` + `npm run
build` produces a static site that runs from any base path).

## Tech

- **TypeScript + [Vite](https://vitejs.dev/)** — a plain npm static build.
- **[three.js](https://threejs.org/)** — the 3D battlefield (WebGL). The HUD and
  menus are a 2D overlay over the 3D view.
- **`@test-cabinet/voxel-runtime`** — decodes and poses the provided **rigid voxel
  rigs** (every unit and structure): `parseGlb` + `poseRig` + `sampleAnimation`, and
  the `/three` binding's `buildPartGeometry` for the GPU-instanced renderer.
- **`@test-cabinet/particle-runtime`** — plays the provided **muzzle-flash** particle
  effects via its `/three` billboard player.

Both runtimes are **vendored** under `vendor/` (their prebuilt `dist` plus a stripped
`package.json`) so `npm ci` resolves them outside the monorepo, exactly as a real run
resolves the packages shipped into its container.

## Assets

Every unit and structure is a **provided** rigid voxel rig, and the muzzle flashes are
provided particle systems (specs/assets.md). The seeded tree — `assets/models.json`,
each entity's `rig.json` + `meshes/*.glb` parts, and `effects/*.json` — is copied under
`public/assets/` and loaded **page-relative** at runtime, so the build runs correctly
whether served at a server root or a per-run sub-path.

## Install & run

```sh
npm ci          # install (requires the committed package-lock.json)
npm run dev     # Vite dev server with HMR
npm run build   # type-check + static production build into dist/
npm run preview # serve the built dist/ locally
```

`npm run build` produces a self-contained static site in `dist/` with `index.html` at
its root; serve that directory from any static host, at any base path.

## Controls (target design — see specs/flow.md)

- **Menus / pause / match-over:** `Up`/`Down` (or `W`/`S`) to move, `Enter`/`Space` to
  confirm, `Esc` to go back; items are also clickable.
- **Build:** click a build-palette entry or press its shortcut (`1`-`9`, `0`, `E` for
  the Solar Extractor) to arm a structure; click an empty build-grid cell to place it.
  `Esc` or right-click disarms.
- **Select a structure:** click a friendly structure (spawner, Solar Extractor, base,
  or Reliquary) to open its panel; `U` upgrades, `X` sells a build-grid structure.
- **Camera:** pan along the lane with the arrow keys / `WASD` and edge-scroll; a key
  re-centres on your base. No zoom.
- **Toggles:** `F3` performance overlay (live FPS), `F4` wireframe.
- **In match:** `Esc` or `P` pauses.

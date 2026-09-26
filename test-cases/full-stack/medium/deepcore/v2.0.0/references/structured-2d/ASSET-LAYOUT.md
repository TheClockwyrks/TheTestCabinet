# Deepcore — asset layout (the canonical committed asset set)

This is the map of every **produced** asset the game loads: where each file lands under
[`assets/`](assets/), its native size and count, which `scripts/gen-*.sh` script produces
it, and the key the loader in [`src/assets.ts`](src/assets.ts) reads it under. It is the
companion to the production **contract** in
[`../../specs/assets.md`](../../specs/assets.md): the spec says _what_ to produce and why;
this file records _where it lands and how it is wired in_ for this reference build.

Everything here was produced **once** with the six on-`PATH` tools (`draw`, `draw-sheet`,
`particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and **committed**. `npm run build` is
self-contained: it bundles these committed files and never invokes the tools. Re-run a
`gen-*.sh` script to regenerate its group (the tools resolve from `PATH`, or from
`$CARGO_TARGET_DIR/release` when off `PATH` — see each script's header).

## How assets are loaded (`src/assets.ts`)

- Everything goes through the **engine's own loader** (`InitApi.assets`, documented in
  `engine/assets.md`), which resolves each path under its asset root, `assets/`, relative
  to the page. Nothing here fetches a file itself and no URL is root-absolute, so the
  built site runs under any sub-path.
- What is loaded is a **manifest, not a directory scan**: `src/assets.ts` states the frame
  count of each cycle and the variant count of each band, because the build knows exactly
  which files it produced. A scan would either miss a file or ask the loader for one that
  was never made.
- The loader is **tolerant**: a file that is missing or will not decode yields `null` for
  that one sprite and the renderer draws a neutral code fallback in its place, so
  `npm run build` and a headless load both succeed before an asset lands.
- `vite.config.ts` copies `public/` into `dist/` verbatim, and `public/assets` links to the
  committed `assets/` tree, so the paths the loader resolves in development are the paths
  the built site serves.

## Tiles — `scripts/gen-world.sh` (all `80 x 80`)

The mine's `TILE` is **80 units** (`src/constants.ts`). Author tiles at that native size;
do not upscale a smaller sprite.

| Files                                                     | Count | Loader key / accessor | Notes                                                                                                                                                                                                      |
| --------------------------------------------------------- | ----- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tiles/{topsoil,rockbed,deepstone,coreshell}-{0,1,2}.png` | 12    | `assets.bands[band]`  | 3 variants per band; picked per cell by a stable hash so a wall does not repeat one stamp. Roughly **uniform** fine grain.                                                                                 |
| `tiles/bedrock.png`                                       | 1     | `assets.bedrock`      | Unminable border / floor / Core-chamber walls.                                                                                                                                                             |
| `tiles/tunnel.png`                                        | 1     | `assets.tunnel`       | The dark carved-tunnel **interior** fill. The inset dirt lip + rounded corners are shaped **in code** (`drawCarved` in `src/render.ts`) over the band-dirt tile; this sprite is clipped inside that shape. |
| `tiles/stone-{0,1}.png`                                   | 2     | `assets.stone`        | Unbreakable-stone boulders — a distinct, smooth, harder-looking material than the grainy dirt.                                                                                                             |
| `tiles/crack/frame{00..03}.png`                           | 4     | `assets.crack`        | Drill-damage overlay (transparent). `drawDrillDamage` picks the frame from each tile's persisted damage fraction (`1 − health/maxHealth`) and draws it on every damaged tile; deepens front-to-back.       |

There is **no gas tile**: a gas pocket is drawn as ordinary band rock (hidden) and betrayed
only by the `gas-seep` VFX below. There is no separate tunnel-edge sprite — the lip is code.

## Ore veins & gemstones — `scripts/gen-world.sh` (`80 x 80`, transparent overlays)

Laid over the band rock. Ores are an embedded **smear** of their mineral (not a discrete
dot); gemstones are a **cut, faceted jewel** — visually distinct from the ore smears
(`specs/mining.md`). Both are keyed by `Ore` and read via `assets.ore[ore]`.

| Files                                                                                           | Count | Loader accessor                                                     |
| ----------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `ore/{ferron,marlite,cuprite,argenite,cobaltine,voltite,halcite,pyronium,cindrite,adamite}.png` | 10    | `assets.ore[ore]` — ore smears                                      |
| `ore/{verdite,roselite,aurite}.png`                                                             | 3     | `assets.ore[ore]` — faceted gemstones (rockbed/deepstone/coreshell) |

## Materials — `scripts/gen-world.sh` (`80 x 80`)

| Files                                              | Count | Loader accessor                   | Notes                                                 |
| -------------------------------------------------- | ----- | --------------------------------- | ----------------------------------------------------- |
| `materials/resonite.png`, `materials/cryenite.png` | 2     | `assets.materials[name]`          | Buried exotic-material nodes (blue / violet crystal). |
| `materials/core.png`                               | 1     | `assets.materials["core"]`        | The glowing Core in its chamber.                      |
| `materials/core-sample.png`                        | 1     | `assets.materials["core-sample"]` | The extracted unstable-sample icon.                   |

## Hazards — lava shimmer — `scripts/gen-world.sh`

| Files                            | Count | Loader accessor | Notes                                                                                                                                                |
| -------------------------------- | ----- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hazards/lava/frame{00..05}.png` | 6     | `assets.lava`   | The molten interior, filling the full `80 x 80` tile. The dirt fringe around a lava cell is shaped **in code** (adjacent lava merges into one pool). |

## The animated miner — `scripts/gen-miner.sh` (`80 x 80`, THE HEADLINE)

One `draw-sheet` cycle per animation state; frames land under `miner/<state>/frameNN.png`
and are read as `assets.miner[state]`, advanced at `ANIM_FPS` against the game's own
accumulated time rather than the wall clock, and mirrored to face west.

| State        | Frames | State      | Frames |
| ------------ | ------ | ---------- | ------ |
| `idle`       | 3      | `jetpack`  | 4      |
| `walk`       | 6      | `fall`     | 3      |
| `drill-down` | 4      | `hurt`     | 3      |
| `drill-side` | 4      | `fuel-out` | 3      |

30 frames total.

## Surface & rocket — `scripts/gen-surface.sh`

| Files                                                                               | Count | Native size | Loader accessor                               | Notes                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ----- | ----------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface/{fuel-depot,ore-market,save-pad,upgrade-shop,supply-depot,launch-pad}.png` | 6     | `112 x 132` | `assets.surface[id]`                          | The six camp buildings (Supply Depot sells the single-use field supplies).                                                                                                                                |
| `surface/cave-mouth.png`                                                            | 1     | `120 x 48`  | `assets.surface["cave-mouth"]`                | The way down at the spawn column.                                                                                                                                                                         |
| `rocket/stage{0..5}.png`                                                            | 6     | `96 x 160`  | `assets.rocket[stage]`                        | The escape rocket; frame chosen by installed-component count, so it visibly gains each part.                                                                                                              |
| `icons/{fuel,hull,cargo,credits,depth,resonite,cryenite}.png`                       | 7     | `20 x 20`   | `assets.icons[name]`                          | Small HUD glyphs.                                                                                                                                                                                         |
| `surface/sky.png`, `surface/ground.png`                                             | 2     | tileable    | `assets.surface.sky`, `assets.surface.ground` | The dusk sky band behind the camp and the scrapped ground strip in front of it, each repeated across the world's width with its bottom edge on `SURFACE_Y`. Either one missing falls back to a flat fill. |

## Particle VFX — `scripts/gen-fx.sh` (`particle-2d` → `system.json`)

Simulated live through `@clockwyrks/particle-runtime`'s `ParticleSimulator` and drawn by
`src/effects.ts` straight into the mine's own transform, so a burst sits at its event's
world position and scrolls with the cell it happened at. The world footprint per kind is
set in `src/effects.ts` (`FOOTPRINT`), scaled to the 80-unit tile.

| Files                                                                                                                                                                        | Count |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `fx/{gas-seep,drill-debris,jetpack-exhaust,ore-sparkle,material-shimmer,gas-explosion,lava-embers,impact-dust,core-extract,core-detonation,launch-exhaust,death-burst}.json` | 12    |

`gas-seep` is the very subtle wisp fired sparsely over on-screen gas pockets
(`emitGasSeeps` in `src/simulation.ts`) — the only tell that a hidden pocket is there.

## Audio — `scripts/gen-audio.sh` (`sfx-synth` / `sfx-sample` / `music`)

Bound to the engine's audio cues by name (`api.audio.load(cue, "audio/<cue>.wav")` in
`src/audio.ts`), which owns the graph, the mute bit, and the first-gesture unlock. Each cue
is declared with a quiet synthesized stand-in first, so a clip that fails to decode leaves
the name playable rather than bringing a frame down.

| Files                                                                                                                              | Count  | Notes                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `audio/{drill,thrust,ore-pickup,material-chime,gas-explosion,lava-sizzle,impact,fabricate,launch,death,alarm-fuel,alarm-core}.wav` | 12     | SFX + the two alarms (some looped).                                                     |
| `audio/music.wav` (+ `audio/music.mid`)                                                                                            | 1 (+1) | The descent bed (looped). The `.mid` is a portable companion; playback uses the `.wav`. |

## Regenerating

```sh
bash scripts/gen-world.sh     # tiles, ore, materials, lava
bash scripts/gen-miner.sh     # the 8 miner cycles
bash scripts/gen-surface.sh   # buildings, cave mouth, rocket, HUD icons
bash scripts/gen-fx.sh        # the 12 particle systems
bash scripts/gen-audio.sh     # the SFX, alarms, and music bed
```

Each script writes its intermediate tool scratch to a temp dir (git-ignored) and only the
finished files under `assets/` are committed. After regenerating, `npm run build` bundles
the new files with no further step.

# Lattice replay bundle — built artifacts

What the browser playback renderer needs, committed here as the single source of
truth and vendored into the UI (see `scripts/vendor-lattice-assets.mjs`).

| File                                  | What it is                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lattice-core.wasm`                   | The simulation itself, compiled for the browser. The renderer instantiates it and steps it a tick at a time; it holds no rules of its own.                                                |
| `sheet.png` / `sheet.json`            | The packed sprite atlas and its layout, built from `source/` by `gen-sheet.mjs`.                                                                                                          |
| `reference-{small,medium,large}.json` | The three scored factories, windowed for playback, built from `../../cases/*.json` by `gen-reference.mjs`. The console's test-case Reference tab plays these through `lattice-core.wasm`. |
| `source/`                             | The per-entity frames the atlas is packed from — see [`source/README.md`](source/README.md).                                                                                              |

All are checked in, and `packages/ui/.../lattice/renderer.vendor.test.ts` asserts
the UI's vendored copies stay byte-identical, so a forgotten resync fails CI rather
than silently rendering with a stale engine or atlas.

## Rebuilding `lattice-core.wasm`

```
cargo build -p lattice-core --target wasm32-unknown-unknown \
  --no-default-features --features playback-abi --release
cp "$(cargo metadata --format-version 1 --no-deps \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["target_directory"])')\
/wasm32-unknown-unknown/release/lattice_core.wasm" lattice-core.wasm
```

The flags matter. `--features playback-abi` turns on the tick-at-a-time driver
**and** the C ABI the browser calls (`alloc`, `playback_load`, `playback_board`,
`playback_step`, `playback_reset`); `--no-default-features` drops the `schema`
feature, which pulls in `schemars` and is only needed by the native artifact
generator. Note the feature is `playback-abi`, **not** `playback`: `playback` alone
now builds the driver with **no** exports (that variant is what a model's engine
links, so its own playback ABI does not collide with these) — a `--features
playback` build would produce a wasm the renderer cannot call.

Rebuild whenever the engine's rules change. Because the engine defines correctness,
a playback build that lags the graded engine would draw a factory that never
happened — the atlas can be stale and merely look wrong, but a stale wasm is wrong.

## Repacking the sheet

```
node gen-sheet.mjs
```

Reads every `source/<entity>_<index>.png`, validates it against that entity's
declared frame count and canvas, and packs one row per entity into `sheet.png`,
emitting the rects and the renderer geometry into `sheet.json`. A missing or
wrongly-sized frame is a hard error — there are no placeholders, because the
renderer has no art to fall back on.

Re-run after re-seeding `source/`.

## Regenerating the reference scenarios

```
node gen-reference.mjs
```

Copies each scored scenario from `../../cases/` with its timeline cut to a dense
2,500-tick window (and its snapshot schedule rewritten to fit — `Scenario::parse`
rejects a snapshot tick past `ticks`). The grid and every entity pass through
untouched: the Reference tab's claim is that a viewer is watching the factory a run
is actually graded on, not an approximation of it, and
`renderer.vendor.test.ts` asserts exactly that entity-for-entity.

The window matters. Unlike a submission's engine — whose playback ABI bounds itself
inside the guest (`PLAYBACK_WINDOW_TICKS` in `lattice-sdk`) — the reference driver
emits a full canonical state every tick with no cap of its own, and a scored
scenario runs 50,000–360,000 ticks. The bound has to be applied to the scenario, and
it is deliberately the same window, so the Reference tab and a run's Results tab
show the same stretch of the same factory. If `PLAYBACK_WINDOW_TICKS` changes,
change `WINDOW_TICKS` here and re-run.

Re-run after re-seeding the scored set (`lattice gen`), and re-vendor afterwards.

# Lattice replay bundle — built artifacts

The two things the browser playback renderer needs, both committed here as the
single source of truth and vendored into the UI (see
`scripts/vendor-lattice-assets.mjs`).

| File | What it is |
| --- | --- |
| `lattice-core.wasm` | The simulation itself, compiled for the browser. The renderer instantiates it and steps it a tick at a time; it holds no rules of its own. |
| `sheet.png` / `sheet.json` | The packed sprite atlas and its layout, built from `source/` by `gen-sheet.mjs`. |
| `source/` | The per-entity frames the atlas is packed from — see [`source/README.md`](source/README.md). |

Both are checked in, and `packages/ui/.../lattice/renderer.vendor.test.ts` asserts
the UI's vendored copies stay byte-identical, so a forgotten resync fails CI rather
than silently rendering with a stale engine or atlas.

## Rebuilding `lattice-core.wasm`

```
cargo build -p lattice-core --target wasm32-unknown-unknown \
  --no-default-features --features playback --release
cp "$(cargo metadata --format-version 1 --no-deps \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["target_directory"])')\
/wasm32-unknown-unknown/release/lattice_core.wasm" lattice-core.wasm
```

The flags matter. `--features playback` turns on the tick-at-a-time driver and the
C ABI the browser calls (`alloc`, `playback_load`, `playback_board`,
`playback_step`, `playback_reset`); `--no-default-features` drops the `schema`
feature, which pulls in `schemars` and is only needed by the native artifact
generator.

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

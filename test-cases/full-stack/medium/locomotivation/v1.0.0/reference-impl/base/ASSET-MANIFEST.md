# Locomotivation — asset manifest (canonical)

This is the **single canonical list** of every asset file the game loads, derived from
[`../../specs/assets.md`](../../specs/assets.md). Every asset agent produces to these exact
paths, and the game (`src/assets.ts`) loads them by globbing `assets/`. Keep this list and
the code in sync — if a path changes, change it here and in the loader.

## Rules

- **Produced only.** Every file below is produced during the run with the six on-`PATH`
  tools (`/cargo-target/the-test-cabinet/release/{draw,draw-sheet,particle-2d,sfx-synth,sfx-sample,music}`).
  No placeholders, no downloads. The build must **not** invoke the tools.
- **Page-relative loading.** Files are imported through Vite globs (`base: './'`), so paths
  resolve relative to the page under any sub-path. Never reference a root-absolute `/assets/…`.
- **Keys.** `src/assets.ts` strips the leading `../assets/` (and, for fx/audio, the
  `fx/` / `audio/` folder) plus the extension to form the lookup key. So
  `assets/train/freight/engine-h.png` → key `train/freight/engine-h`,
  `assets/fx/cargo-splinter.json` → key `cargo-splinter`, `assets/audio/horn.wav` → key `horn`.
- **Orientation.** Every campaign track is **horizontal** (runs along a row), so only the
  horizontal (`-h`) train and track sprites are loaded. The vertical (`-v`) variants and a
  vertical track tile are **not needed** unless a future level adds a vertical (`!`) lane.
- **Palette & ¾ look** are in `specs/overview.md`. Frame counts below are the intended
  minimum for a believable cycle; the loader tolerates a different count (it globs all
  frames), but produce a consistent set per facing.

---

## 1. Worker — `draw-sheet` (HEADLINE)

Four-facing animated character (`specs/character.md`). Layout
`assets/worker/<cycle>/<facing>/frameNN.png`, `NN` zero-padded from `00`. A real
front/back/left/right character — **not** a mirrored left/right pair.

| Path (per facing unless noted) | Tool | Facings | Frames | Brief |
| --- | --- | --- | --- | --- |
| `assets/worker/idle/<facing>/frameNN.png` | draw-sheet | down, up, left, right | 4 | Subtle breathing/settle bob, standing. |
| `assets/worker/walk/<facing>/frameNN.png` | draw-sheet | down, up, left, right | 6 | Clear unladen walk cycle. |
| `assets/worker/sprint/<facing>/frameNN.png` | draw-sheet | down, up, left, right | 6 | Faster, leaning cadence. |
| `assets/worker/carry/<facing>/frameNN.png` | draw-sheet | down, up, left, right | 6 | Visibly laden/hunched haul cycle. |
| `assets/worker/drop/down/frameNN.png` | draw-sheet | down (shared) | 4 | Brief set-down beat. |
| `assets/worker/squish/frameNN.png` | draw-sheet | shared | 5 | Signature death: a sharp flatten/impact. |

Facings = `{down, up, left, right}`. Keys therefore look like `worker/walk/left/frame03`.

## 2. Trains — `draw` (CO-STAR)

Chunky ¾ bodies, horizontal flank (`-h`). A long train tiles its car sprites behind the
engine. **Rideable flat-tops must be unmistakably distinct** (open, flat, boardable) from
the lethal engine/boxcars. Layout `assets/train/<kind>/<piece>-h.png`.

| Path | Tool | Brief |
| --- | --- | --- |
| `assets/train/freight/engine-h.png` | draw | Freight engine — chunky, heavy (lethal). |
| `assets/train/freight/boxcar-h.png` | draw | Sealed boxcar (lethal). |
| `assets/train/freight/flat-top-h.png` | draw | Regular-length **rideable** flat deck. |
| `assets/train/freight/flat-top-half-h.png` | draw | Half-length **rideable** flat deck (tighter board). |
| `assets/train/commuter/engine-h.png` | draw | Commuter lead car — sleek, medium. |
| `assets/train/commuter/coach-h.png` | draw | Commuter coach car. |
| `assets/train/bullet/nose-h.png` | draw | Bullet nose car — needle-nosed. |
| `assets/train/bullet/body-h.png` | draw | Bullet body car. |
| `assets/train/headlight.png` | draw | Shared warm headlight glow cast ahead of a train. |

Last-train consists reuse these: the engine is the lane kind's `engine`/`nose`; `boxcar`
cars reuse `freight/boxcar-h`; `flat-top` / `flat-top-half` reuse the freight flat-tops
(the rideable cars), regardless of the lane's kind (`specs/trains.md`, `src/levels.ts`).

## 3. Yard tiles — `draw`

40×40 tiles, tiling without an obvious repeat. Layout `assets/tiles/<kind>[-variant].png`.

| Path | Tool | Brief |
| --- | --- | --- |
| `assets/tiles/ground-0.png` | draw | Gravel yard floor, variant 0. |
| `assets/tiles/ground-1.png` | draw | Gravel floor, variant 1 (subtle difference). |
| `assets/tiles/ground-2.png` | draw | Gravel + grass accent, variant 2. |
| `assets/tiles/track-h.png` | draw | Horizontal rail lane — rails + timber sleepers. |
| `assets/tiles/bridge-h.png` | draw | Timber bridge deck over the gap (a crossing). |
| `assets/tiles/refuge.png` | draw | Marked safe pocket / platform. |
| `assets/tiles/gap-0.png` | draw | Impassable water/void, variant 0. |
| `assets/tiles/gap-1.png` | draw | Water/void, variant 1 (optional shimmer variety). |
| `assets/tiles/wall.png` | draw | ¾ building/scenery body (impassable). |
| `assets/tiles/roof.png` | draw | ¾ building roof top for wall footprints. |

## 4. Cargo, dispensers, drop zones, signals, levers — `draw`

### Packages `assets/cargo/<color>-<class>.png`

Color reads at a glance; weight class reads from size/shape. Colors `{red, blue, green,
amber}` × classes `{parcel, crate, load}` = 12 base sprites.

| Path | Tool | Brief |
| --- | --- | --- |
| `assets/cargo/red-parcel.png` | draw | Small red parcel (weight 30). |
| `assets/cargo/red-crate.png` | draw | Medium red crate (weight 55). |
| `assets/cargo/red-load.png` | draw | Heavy red load (weight 80). |
| `assets/cargo/blue-parcel.png` | draw | Small blue parcel. |
| `assets/cargo/blue-crate.png` | draw | Medium blue crate. |
| `assets/cargo/blue-load.png` | draw | Heavy blue load. |
| `assets/cargo/green-parcel.png` | draw | Small green parcel. |
| `assets/cargo/green-crate.png` | draw | Medium green crate. |
| `assets/cargo/green-load.png` | draw | Heavy green load. |
| `assets/cargo/amber-parcel.png` | draw | Small amber parcel (optionals are amber). |
| `assets/cargo/amber-crate.png` | draw | Medium amber crate. |
| `assets/cargo/amber-load.png` | draw | Heavy amber load. |

### Unique packages `assets/cargo/unique-<color>-<class>.png`

Distinctly **marked (stamped/sealed) crates**. Only the (color,class) combos that appear as
uniques in the campaign (`src/levels.ts`) are needed:

| Path | Tool | Brief |
| --- | --- | --- |
| `assets/cargo/unique-red-load.png` | draw | Sealed red load — unique (L3, L5). |
| `assets/cargo/unique-red-crate.png` | draw | Sealed red crate — unique (L4). |
| `assets/cargo/unique-green-load.png` | draw | Sealed green load — unique (L4, L5, L6). |
| `assets/cargo/unique-blue-crate.png` | draw | Sealed blue crate — unique (L6). |

### Dispensers, zones, signals, levers `assets/elements/…`

| Path | Tool | Brief |
| --- | --- | --- |
| `assets/elements/dispenser-red.png` | draw | Red chute station (source of red freight). |
| `assets/elements/dispenser-blue.png` | draw | Blue chute station. |
| `assets/elements/dispenser-green.png` | draw | Green chute station. |
| `assets/elements/dispenser-amber.png` | draw | Amber chute station (not used by a level yet; produce for completeness/optional reuse). |
| `assets/elements/zone-red.png` | draw | Red delivery pad + ¾ marker post. |
| `assets/elements/zone-blue.png` | draw | Blue delivery pad. |
| `assets/elements/zone-green.png` | draw | Green delivery pad. |
| `assets/elements/zone-amber.png` | draw | Amber delivery pad. |
| `assets/elements/signal-clear.png` | draw | Crossing signal — clear (green). |
| `assets/elements/signal-warning.png` | draw | Crossing signal — warning (amber). |
| `assets/elements/signal-danger.png` | draw | Crossing signal — danger (red). |
| `assets/elements/lever-default.png` | draw | Junction lever, default branch. |
| `assets/elements/lever-thrown.png` | draw | Junction lever, diverted branch. |

## 5. Particle VFX — `particle-2d`

Authored as `system.json` under `assets/fx/`, played LIVE via
`@test-cabinet/particle-runtime/canvas` (`src/particles.ts`). Keys must match `FxKind`.

| Path | Tool | Required? | Brief |
| --- | --- | --- | --- |
| `assets/fx/cargo-splinter.json` | particle-2d | **REQUIRED** | Physical crate shatter when a train destroys freight. |
| `assets/fx/worker-squish.json` | particle-2d | Expected | Impact burst when the worker is killed. |
| `assets/fx/delivery-burst.json` | particle-2d | Expected | Satisfying confirm burst on delivery. |
| `assets/fx/footstep-dust.json` | particle-2d | Expected | Ground dust as the worker moves (esp. sprint). |
| `assets/fx/signal-spark.json` | particle-2d | Optional | Spark/steam as a train passes / a signal flips to danger. |
| `assets/fx/last-train-smoke.json` | particle-2d | Expected (last-train levels) | Smoke/steam as the last train arrives/departs. |

## 6. Audio — `sfx-synth` / `sfx-sample` / `music`

Flat under `assets/audio/*.wav`, played via Web Audio (`src/audio.ts`). No autostart before
the first interaction; the `M` mute toggle applies. Keys match `Cue` / `LoopCue`.

| Path | Tool | Loop? | Brief |
| --- | --- | --- | --- |
| `assets/audio/footstep.wav` | sfx-synth / sfx-sample | no | Worker step cadence. |
| `assets/audio/pickup.wav` | sfx-synth / sfx-sample | no | Lifting a package. |
| `assets/audio/delivery.wav` | sfx-synth / sfx-sample | no | Delivering to a matching zone (chime). |
| `assets/audio/horn.wav` | sfx-synth / sfx-sample | no | Train approaching a crossing (telegraph). |
| `assets/audio/rumble.wav` | sfx-synth / sfx-sample | **loop** | Rumble; gain rises with train proximity. |
| `assets/audio/impact.wav` | sfx-synth / sfx-sample | no | Squish / cargo crunch. |
| `assets/audio/confirm.wav` | sfx-synth / sfx-sample | no | Quota complete / menu confirm. |
| `assets/audio/alarm.wav` | sfx-synth / sfx-sample | no | Low-clock alarm. |
| `assets/audio/whistle.wav` | sfx-synth / sfx-sample | no | Last-train whistle/departure. |
| `assets/audio/music.wav` | music | **loop** | Driving industrial yard bed (a `music.mid` is produced alongside but not loaded). |

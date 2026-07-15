# Locomotivation — asset-production contract

This is the spec that makes Locomotivation a **full-stack** case. There is **no**
pre-made art, animation, effects, or audio in this project. You must **produce every
asset the game plays** during this build, with the **six tools on your `PATH`**, and
wire the produced files into the game. Run each tool's `--help` to learn its
operations; the tools are:

| Tool | Produces | Consumed as |
| --- | --- | --- |
| `draw` | one sprite → PNG | a PNG the game draws |
| `draw-sheet` | a sprite sheet → per-frame PNGs | frames the game animates |
| `particle-2d` | a particle system → `system.json` | played live via `@test-cabinet/particle-runtime`'s `./canvas` binding |
| `sfx-synth` | a procedural sound → `.wav` | played via Web Audio |
| `sfx-sample` | a sampled effect over the baked `combat-core` pack → `.wav` | played via Web Audio |
| `music` | sequenced music over the baked `gm-lite` bank → `.wav` (+ `.mid`) | played via Web Audio |

**The produced files are build inputs.** Produce them once, commit them under
`assets/`, and have the build load them. The build itself must **not** invoke the
tools (they exist only while the run is live) — `npm ci && npm run build` must be
self-contained.

**Loading rule (critical).** The build is served from a per-run **sub-path**, so
load every produced file with a **page-relative** URL (never a leading `/`). Import
assets through the bundler (so it rewrites the paths), or build URLs relative to the
document. Set a relative bundler base (Vite: `base: './'`). A root-absolute asset
URL will 404 in playback.

**The bar.** These assets are **half of what this build is judged on**
(`specs/overview.md`). Set mood and tone with real intent — do **not** ship
placeholder rectangles, ad-hoc code-drawn shapes in place of a produced sprite, flat
flashes in place of the produced particles, or silence. Two assets are the
centerpieces: the **animated worker** and the **trains**. One particle system is
**required**: the **cargo splinter** when a train destroys freight.

Everything below lands under `assets/` in your project (organize subfolders as you
like; the paths are a suggested layout). The palette and ¾ look are in
`specs/overview.md`.

---

## 1. The animated worker (headline) — `draw-sheet`

The yard worker (`specs/character.md`) is the headline asset: a believable character
in the ¾ view that **faces four directions** and animates a **distinct cycle** per
state. Produce sprite-sheet cycles with `draw-sheet`, authored for **each of the
four facings — down, up, left, right** (a real front / back / left / right
character, **not** one facing mirrored):

| Cycle | Facings | Notes |
| --- | --- | --- |
| `idle` | down, up, left, right | A subtle breathing/settle bob. |
| `walk` | down, up, left, right | A clear walk cycle (multiple frames). |
| `sprint` | down, up, left, right | Faster, leaning cadence. |
| `carry` | down, up, left, right | Visibly **laden** — the same walk but hauling freight, more laboured. |
| `drop` | down (or shared) | A brief set-down beat. |
| `squish` | shared | The signature death: a sharp flatten/impact. |

Suggested layout: `assets/worker/<cycle>/<facing>/frameNN.png` (e.g.
`assets/worker/walk/left/frame00.png`). The game selects the cycle from the worker's
state and the facing from its direction (`specs/character.md`), advancing frames on
the fixed clock. Carried packages may be drawn as a separate layer on top of the
`walk`/`idle` cycles instead of a full `carry` set **only if** the result still
reads as clearly laden and laboured — but a genuine `carry` cycle is preferred. A
stiff, single-frame, or left/right-mirror-only worker is a **failed build**.

## 2. The trains (co-star) — `draw` (and optional `draw-sheet`)

Each train kind (`specs/trains.md`) is a chunky **¾ body** — a top and a side face,
not a flat bar — drawn to the **orientation of the track** it runs (a horizontal
train shows its long **flank**; a vertical train shows its **front/back**). Produce,
for each kind, the pieces its consist needs, in both orientations used by the levels:

| Kind | Pieces | Reads as |
| --- | --- | --- |
| **Freight** | engine + **boxcar** + **flat-top (regular)** + **flat-top (half-length)** | Long, heavy; the flat-tops are the rideable last-train cars. |
| **Commuter** | engine/lead car + coach | Sleek, medium. |
| **Bullet** | nose car + body | Needle-nosed, fast. |

Suggested layout: `assets/train/<kind>/<piece>-h.png` (horizontal flank) and
`-v.png` (vertical front/back) — e.g. `assets/train/freight/flat-top-h.png`. A long
train is drawn by tiling its car sprites along the track behind the engine.

**The rideable flat-top cars must be unmistakably distinct** from the lethal engine
and boxcars — an open, flat, obviously-boardable deck vs a sealed, tall, dangerous
body — because a player bets their life on reading the difference
(`specs/trains.md`). A subtle **running-gear / wheel** animation via `draw-sheet` is
encouraged for polish but not required; the bodies may be static `draw` sprites.
Each train also needs a **headlight** it casts ahead (a produced glow sprite or a
code-drawn light in the palette).

## 3. The yard tiles — `draw` (gap optionally `draw-sheet`)

Produce the tile art for each kind (`specs/world.md`), in the palette, tiling
without an obvious single-texture repeat (author 2–3 variants where a kind covers
large areas):

| Tile | Tool | Notes |
| --- | --- | --- |
| Ground (gravel) + grass accent | `draw` | 2–3 variants so a field does not visibly repeat. |
| Track — rails + sleepers, horizontal and vertical | `draw` | Reads clearly as a live rail lane. |
| Bridge deck (timber) | `draw` | Over the gap; visibly a crossing. |
| Refuge bay / platform | `draw` | Visibly a **safe pocket**. |
| Gap / water | `draw` (or `draw-sheet` for a slow shimmer) | Impassable; unmistakably not walkable. |
| Wall / building footprint, roof | `draw` | ¾ building bodies that bound and theme the level. |

Suggested layout: `assets/tiles/<kind>[-variant].png`.

## 4. Freight, dispensers, drop zones, signals, levers — `draw`

| Element | Tool | Notes |
| --- | --- | --- |
| **Packages** — Red / Blue / Green / Amber, in Parcel / Crate / Load reads | `draw` | Color reads at a glance; the weight class reads from size/shape. The **unique** package is a distinctly marked (stamped/sealed) crate. `assets/cargo/<color>-<class>.png`. |
| **Dispenser** — a chute station per color (or neutral with a color indicator) | `draw` | Reads as the source of its color. |
| **Drop zone** — a color-coded pad + ¾ marker post | `draw` | Matches its color; reads as a delivery target. |
| **Crossing signal** — clear / warning / danger | `draw` or `draw-sheet` | Three states in the signal colors (`specs/overview.md`), used to telegraph trains (`specs/trains.md`). |
| **Lever** — junction switch, two settings | `draw` | The ¾ handle shows which branch is live (`specs/trains.md`). |

## 5. Particle VFX — `particle-2d` (cargo splinter REQUIRED)

Author each as a `particle-2d` `system.json` under `assets/fx/`, and play it **live**
through `@test-cabinet/particle-runtime`'s `./canvas` binding (import the installed
package; do not reimplement it) — firing a fresh simulated burst at the moment and
position of each event, so it **varies shot to shot**, not a flat flash or a
hand-coded loop.

| Effect | When | Required? |
| --- | --- | --- |
| **Cargo splinter** | a train destroys a package (on-track drop or death-carry) | **REQUIRED** — a physical shatter of the crate; the signature VFX. |
| **Worker squish** | the worker is killed under a train | Strongly expected — a produced impact burst. |
| **Delivery burst** | a package is delivered to its zone | Expected — a satisfying confirm. |
| **Footstep dust** | the worker moves (esp. sprinting) | Expected — sells the ¾ ground. |
| **Signal spark / steam** | a train passes / signal flips to danger | Optional polish. |
| **Last-train departure** | the last train arrives/departs (smoke/steam) | Expected on levels with a last train. |

The **cargo-splinter** burst in particular must read as a produced, physical
shatter — it is the required, called-out effect and a reviewer will look for it when
a train smashes freight.

## 6. Audio — `sfx-synth` / `sfx-sample` / `music`

Produce the yard's sound with the audio tools and play it via **Web Audio**. Audio
must **not** autostart before the first user interaction, and a **mute** toggle
(`specs/controls.md`) must be present.

| Sound | Tool | When |
| --- | --- | --- |
| Footsteps | `sfx-synth`/`sfx-sample` | Worker moving (a light loop or step cadence). |
| Pickup | `sfx-synth`/`sfx-sample` | Lifting a package. |
| Delivery chime | `sfx-synth`/`sfx-sample` | Delivering to a matching zone. |
| Train **horn** | `sfx-synth`/`sfx-sample` | A train approaching a crossing (telegraph). |
| Train **rumble** | `sfx-synth`/`sfx-sample` | A looping rumble that **rises with train proximity**. |
| Lethal **impact / crunch** | `sfx-synth`/`sfx-sample` | The worker squished / cargo smashed. |
| Confirm | `sfx-synth`/`sfx-sample` | Completing the quota / a menu confirm. |
| Low-clock **alarm** | `sfx-synth`/`sfx-sample` | The shift clock under its low threshold (`specs/flow.md`). |
| Last-train **whistle/departure** | `sfx-synth`/`sfx-sample` | The last train arriving/leaving. |
| **Music bed** | `music` | A driving industrial yard loop under play (looped). |

Wire each to its event; loop the rumble and the music bed. Use the horn and the
rising rumble as real **telegraphing** cues (`specs/trains.md`) — a player should
*hear* a train coming.

---

## Summary of the produced set

At minimum, a complete build produces and wires in: the **four-facing animated
worker** (idle/walk/sprint/carry per facing, plus drop and squish); the **three
train kinds** as ¾ bodies (with the freight's rideable flat-tops distinct) in the
orientations the levels use; the **yard tileset** (ground, track, bridge, refuge,
gap, wall); the **color-coded packages** (with the unique marked), **dispensers**,
**drop zones**, **signals**, and **levers**; the **particle VFX** (the **required**
cargo splinter, plus squish, delivery, and dust); and the **audio** (footsteps,
pickup, delivery, horn, rising rumble, impact, confirm, low-clock alarm, last-train
whistle, and a music bed). Every one is produced with the on-`PATH` tools and loaded
page-relative. The **worker animation** and the **trains** are the centerpieces the
run is judged on.

# Hollowdeep — Assets you produce (the production contract)

Hollowdeep ships with **no** pre-made art, effects, or sound. Instead, the run image
puts six **asset-generation tools** on your `PATH`, and **you must produce every
asset the game plays with those tools, during this build**, then wire the produced
files into the game. This is the defining requirement of the case: you are the
artist, the VFX author, and the sound designer as well as the engineer. This file is
the contract — what to produce, which tool makes it, where it lands, and how it is
wired in. **Read it as carefully as the simulation specs.**

Every measurement and color here is consistent with `specs/overview.md` (the palette
and coordinate system) and the system specs; when this file gives a value it matches
them.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so all UI/HUD chrome is drawn **in
code** (below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | tiles, machines, resource items, HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the delvers' animations |
| `particle-2d` | a particle system → a `system.json` | the gas overlays, dig dust, machine exhaust |
| `sfx-synth` | a procedural sound → a `.wav` | dig / build / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer dig / build / machine / alarm cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the ambient underground bed |

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is
the tool's own help, not restated here. In outline, each tool **records the operations
you run into a log and then renders or emits the finished file**: you initialize it,
issue the drawing / authoring operations, and render/emit the output, writing the
finished file into your project under **`assets/`**. Consult each tool's `--help` for
the exact initialize / operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …). `draw-sheet` is
  `draw` plus a `--frame <index>` on every operation, emitting **one separate PNG per
  frame** (frames are separate files, never regions of one image).
- `particle-2d` authors a **system** — emitters, forces, and per-particle curves —
  that is **simulated live**; its `render`/emit step writes the `system.json` that is
  the asset. You do **not** place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or
  sequenced notes and render a PCM `.wav`; `music` also emits a portable `.mid` score
  alongside its `.wav`. `sfx-sample` and `music` draw on a **baked sample pack /
  instrument bank** already in the image (browse it via the tool's help); a synth
  from `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the
build itself does. The built site is **not guaranteed to be served from the root of
its origin** — when it is played back it is mounted under a **per-run sub-path** (a
path like `/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/dirt.png`). It ignores the page's location, resolves against the origin
  root, and 404s under a sub-path.
- **Reference assets relative to the document or module instead.** Prefer letting your
  bundler resolve them: import each PNG / `.wav` / JSON, or use a bundler directory
  glob (for example Vite's `import.meta.glob('../assets/**/*.png', { eager: true,
  query: '?url' })`) and use the URLs it returns. A runtime `new URL('./assets/…',
  import.meta.url)` also works if your bundler can statically resolve it.
- **Configure your bundler's base to be relative** (for Vite, `base: './'`) so the
  emitted JS, CSS, and asset URLs are all page-relative.

This governs the produced art, the `system.json` files, the `.wav`s, and the bundled
JS/CSS alike. The quickest self-check: serve your `dist/` from a non-root sub-path and
confirm the game loads with no 404s.

## Sprites — `draw` (tiles, machines, items, icons)

Produce a **single PNG per sprite** with `draw`, on a small transparent (straight-
alpha) canvas — **32×32** is a good tile/sprite size (icons may be smaller, e.g.
**16×16** or **24×24**). These are **pixel art**: draw at the sprite's native size and
sample it with **nearest-neighbor** in the game (`imageSmoothingEnabled = false` for
Canvas, `image-rendering: pixelated` for DOM) so it stays crisp. Land them under
`assets/` in a sensible layout (for example `assets/tiles/`, `assets/machines/`,
`assets/items/`, `assets/icons/`).

Produce at least these, in the palette from `specs/overview.md`:

- **Tiles** — the world's materials, so the cross-section reads at a glance
  (`specs/world.md`): **dirt**, **ore** (dirt with a visible mineral vein), **rock**,
  **bedrock**, **open/dug space** (an interior wall/backing so open tiles do not read
  as holes), and the built **wall**, **floor**, **ladder**, and **wire**. Tiling tiles
  should sit flush against their neighbors.
- **Machines** — the **coal/manual generator**, the **oxygen diffuser**, the **pump**,
  and (if you build refining as a machine) the **refinery** (`specs/power.md`,
  `specs/economy.md`). A machine sprite should read as active vs. idle — either draw a
  running variant or let the exhaust effect and glow carry it.
- **Resource items** — the stockpile/hauled icons for **ore**, refined **material**,
  and **fungus/food** (`specs/economy.md`).
- **HUD icons** — the small marks the dashboard and palette use: **oxygen**, **CO2**,
  **power**, **food**, **alert**, and a tool/building glyph for each palette entry
  (`specs/flow.md`, `specs/controls.md`). These sit inside the in-code HUD.

## Animations — `draw-sheet` (the delvers)

Produce the delvers' animations with `draw-sheet`, which emits **one PNG per frame**.
The delver is the one thing on screen that must feel **alive**, so it is animated, not
a static sprite. Produce at least these cycles, each as a short sequence of frames
(land them under, for example, `assets/delver/walk/`, `assets/delver/dig/`,
`assets/delver/carry/`, `assets/delver/idle/`, one PNG per frame):

- **Walk** — a side-view walk cycle (the delver faces the direction it moves; produce
  one facing and **mirror** it in code, or produce both).
- **Dig** — a mining swing, played while the delver mines a tile (`specs/world.md`).
- **Carry** — hauling material/ore/food, played while the delver hauls
  (`specs/economy.md`, `specs/delvers.md`).
- **Idle** — a small breathing/looking idle for when a delver has no job.

In the game, **play the matching cycle for what the delver is doing**, advancing
frames on a timer so the motion reads (a walk of several frames looping, a dig swing
looping while mining, etc.). Draw the delver at a size that fits comfortably in a tile
(the suit color and a helmet glow from `specs/overview.md`). It is fine to reuse a body
across cycles; the point is that the delver visibly walks, digs, carries, and idles.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The gas overlays and the world's puffs and vents are **particle systems** you author
with `particle-2d` and **play live** — not flat tints or hand-coded effects.
`particle-2d` authors a system (emitters, forces, per-particle size/opacity/color
curves) whose `render`/emit step writes a **`system.json`**; land them under, for
example, `assets/fx/`. Produce at least:

- **Oxygen haze** — a fine, **rising** drift in the oxygen color (`specs/overview.md`),
  the overlay for breathable air.
- **CO2 plume** — a heavier, **settling/sinking** drift in the CO2 color, the overlay
  for waste gas. Together the two must read as the buoyancy in `specs/gas.md` — oxygen
  up, CO2 low — by their motion as well as color.
- **Dig dust** — a short one-shot puff thrown when a tile is mined (`specs/world.md`).
- **Machine steam / exhaust** — a small looping vent for a running generator/diffuser
  (`specs/power.md`).

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency — do **not** fetch or reimplement it). For this 2D
game use its **`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a
parsed `system.json` and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also exported if you would rather
composite the particles yourself.)

**Drive the overlays from the simulation.** The oxygen-haze and CO2-plume systems are
**overlays driven by tile concentration** (`specs/gas.md`): spawn/scale the effect
where a gas is present in the world and in proportion to how much — a room full of
breathable air shows dense oxygen haze, a low tunnel choked with CO2 shows a thick
plume, and both thin as the gas clears. The dig-dust system is a **one-shot** played
at a mined tile's position; the machine exhaust **loops** at a running machine's vent.
Because these are simulated, they vary play to play — that variation is correct; do not
freeze them.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the colony's sound with the audio tools and play the resulting `.wav`s via the
Web Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least a **dig** cue (a pick/impact), a **build/place**
  cue, and a **low-oxygen alarm** with `sfx-synth` and/or `sfx-sample`, and optionally
  a soft **machine hum** loop for a running machine. `sfx-synth` builds a sound from
  synth voices alone; `sfx-sample` layers over the baked sample pack (browse it via its
  `--help`) for a richer result — use whichever suits each cue.
- **Music** — produce an **ambient underground music bed** with `music`: a slow, low,
  atmospheric loop under the colony. `music` emits both a `.wav` (the ready asset you
  play) and a `.mid` score alongside it; **play the `.wav`** (the `.mid` is a portable
  companion you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching
  event — the dig cue when a tile is mined, the build cue on a completed build, the
  alarm when oxygen goes critical (`specs/flow.md`) — and loop the music bed and any
  machine hum. **Do not autostart audio before the player interacts** (browsers block
  autoplay), and provide a **mute** toggle (`specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD/dashboard chrome is
drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **HUD dashboard** — the top-strip vitals (oxygen, CO2, power, stocks,
  cycle clock, speed, alerts) and the bottom-strip **delver roster** and **build
  palette / tool bar** (`specs/flow.md`). Its small **icons** may be produced `draw`
  sprites, but the panels, bars, meters, text, and layout are code.
- All **menus, overlays, panels, and state screens** — title, how-to-play, pause,
  colony-lost (`specs/flow.md`).
- **Selection and tool feedback** — dig designations, build ghosts, the hovered-tile
  cursor, priority indicators (`specs/controls.md`).
- The **gas overlay's driving** — the logic that spawns and scales the produced haze
  and plume systems from tile concentrations (the *systems* are produced; deciding
  where and how strongly to play them is code).

## Genuinely produce the assets — this is the point of the case

The assets must be **genuinely produced with these tools**. A build that ships
**placeholder rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a
**flat colored fill in place of the produced gas particles**, **downloaded or bundled
art**, or **silence in place of produced audio** has not done the task, no matter how
good the simulation is — the produced assets are half of what this case scores
(`specs/overview.md`, the Presentation & Assets domain). Produce real pixel-art
sprites, real animated delver sheets, real simulated particle overlays, and real sound
and music with the six tools, and wire those produced files into the game. Everything
the game shows and plays should trace back either to a file you produced with a tool
here, or to HUD/menu chrome you drew in code as listed above.

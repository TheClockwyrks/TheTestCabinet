# Junction — Assets you produce (the production contract)

Junction ships with **no** pre-made art, effects, or sound. Instead, the run image puts
six **asset-generation tools** on your `PATH` to help you make them, and **you
must produce every asset the game plays — with those tools or any other way you
prefer — and commit the produced files**, then wire them into the game. Produce
them as a one-time step: your build (`npm run build`) must be **self-contained**,
bundling the committed files without invoking the tools, which are on your
`PATH` only while this run is live — not when the build is re-run to validate
it or rebuilt from the published source. This is the defining requirement of the
case: you are the artist, the VFX author,
and the sound designer as well as the engineer. This file is the contract — what to
produce, which tool makes it, where it lands, and how it is wired in. **Read it as
carefully as the simulation specs.**

Every measurement and color here is consistent with `specs/overview.md` (the palette
and coordinate system) and the system specs; when this file gives a value it matches
them.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so **all HUD/dashboard/overlay chrome is
drawn in code** (below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | zone buildings (per tier), road/rail/station tiles, power/water tiles, vehicles, HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | animated signals/crossings, construction, vehicle cycles |
| `particle-2d` | a particle system → a `system.json` | pollution haze, construction dust, milestone fireworks |
| `sfx-synth` | a procedural sound → a `.wav` | build / chime / alert cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer build / notification / alert cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the ambient city music bed |

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is the
tool's own help, not restated here. In outline, each tool **records the operations you
run into a log and then renders or emits the finished file**: you initialize it, issue
the drawing / authoring operations, and render/emit the output, writing the finished
file into your project under **`assets/`**. Consult each tool's `--help` for the exact
initialize / operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `stroke-rect`, `flood-fill`,
  `mirror-horizontal`, …). `draw-sheet` is `draw` plus a `--frame <index>` on every
  operation, emitting **one separate PNG per frame** (frames are separate files, never
  regions of one image).
- `particle-2d` authors a **system** — emitters (`add-emitter`), forces (`set-forces`),
  and per-particle curves (`set-particle`) — that is **simulated live**; its `render`
  step writes the `system.json` that is the asset. You do **not** place individual
  particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or sequenced
  notes and `render` a PCM `.wav`; `music` also emits a portable `.mid` score alongside
  its `.wav`. `sfx-sample` and `music` draw on a **baked sample pack / instrument bank**
  already in the image (browse it via `list-samples` / the tool's help); a synth from
  `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the build
itself does. The built site is **not guaranteed to be served from the root of its
origin** — when it is played back it is mounted under a **per-run sub-path** (a path
like `/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/road.png`). It ignores the page's location, resolves against the origin root,
  and 404s under a sub-path.
- **Reference assets relative to the document or module instead.** Prefer letting your
  bundler resolve them: import each PNG / `.wav` / JSON, or use a bundler directory glob
  (for example Vite's `import.meta.glob('../assets/**/*.png', { eager: true, query:
  '?url' })`) and use the URLs it returns. A runtime `new URL('./assets/…',
  import.meta.url)` also works if your bundler can statically resolve it.
- **Configure your bundler's base to be relative** (for Vite, `base: './'`) so the
  emitted JS, CSS, and asset URLs are all page-relative.

This governs the produced art, the `system.json` files, the `.wav`s, and the bundled
JS/CSS alike. The quickest self-check: serve your `dist/` from a non-root sub-path and
confirm the game loads with no 404s.

## Sprites — `draw` (buildings, tiles, vehicles, icons)

Produce a **single PNG per sprite** with `draw`, on a small transparent (straight-
alpha) canvas — **32×32** is a good tile/building size (icons may be smaller, e.g.
**16×16** or **24×24**; a large civic building or plant may span a **2×2** footprint,
so a **48×48** or **64×64** sprite is fine for those). These are **pixel art**: draw at
the sprite's native size and sample it with **nearest-neighbor** in the game
(`imageSmoothingEnabled = false` for Canvas, `image-rendering: pixelated` for DOM) so it
stays crisp. Land them under `assets/` in a sensible layout (for example
`assets/zones/`, `assets/transit/`, `assets/utility/`, `assets/vehicles/`,
`assets/icons/`).

Produce at least these, in the palette from `specs/overview.md`:

- **Zone buildings, per density tier** — the developed lots for each zone, so a player
  reads the city at a glance (`specs/map.md`). For **each** of **residential**,
  **commercial**, and **industrial**, produce a sprite for **each density tier** (at
  least low / medium / high — so at least **9** building sprites): a low-density
  residential cottage, a mid-density block, a high-density tower; a corner shop, a
  storefront row, an office tower; a workshop, a factory, a heavy plant. Each zone kind
  must read as its own **form** as well as its hue (`specs/overview.md`), and a higher
  tier must read as denser/taller than a lower one. An **empty zoned lot** may be drawn
  in code (a colored, marked tile) or as a produced sprite — your choice.
- **Transit tiles** — the **road** (draw it so tiles connect into continuous roads —
  a straight, a corner, and a junction/intersection read best, but a single tileable
  road sprite is acceptable), the **rail/metro** line tile, and the **station/stop**
  (`specs/transit.md`). Roads and rail must read as clearly different kinds of link.
- **Utility tiles** — the **power plant**, the **power line (wire)**, the **water
  source** (pump/tower), and the **water pipe** (`specs/utilities.md`). A wire and a
  pipe must be distinguishable.
- **Vehicles** — at least a **car** (and optionally a truck/goods vehicle and a
  train/tram car) moved along the network in code (`specs/transit.md`). These are small
  sprites; a couple of variants add life.
- **HUD icons** — the small marks the dashboard and palette use: **treasury/money**,
  **population**, **power**, **water**, the three **R/C/I** zone glyphs, **alert**, and
  a tool glyph for each palette entry (`specs/flow.md`, `specs/controls.md`). These sit
  inside the in-code HUD.

## Animations — `draw-sheet` (signals, construction, vehicles)

Produce a few animated sprite **sheets** with `draw-sheet`, which emits **one PNG per
frame**. These are the things on the map that should feel **alive**. Produce at least
**two** animated sheets, each as a short sequence of frames (land them under, for
example, `assets/anim/signal/`, `assets/anim/construction/`, one PNG per frame), and
play the sequence on a timer in the game. Good choices:

- **A traffic signal or level crossing** — a short cycle (e.g. green → amber → red for a
  signal, or the gate/lights of a rail level crossing) played at intersections/crossings
  (`specs/transit.md`).
- **A building under construction** — a short sequence (scaffold → framed → topped out)
  played on a tile while it is **developing/upgrading** before its finished building
  sprite appears (`specs/map.md`), paired with the construction-dust particle effect
  (below).
- **Vehicle variants / a train** — optionally, a rolling/animated vehicle or a
  multi-car train cycle (`specs/transit.md`).

In the game, **play the matching sheet for what is happening** — the signal cycling at a
junction, the construction sequence while a lot builds — advancing frames on a timer so
the motion reads. It is fine to reuse art across cycles; the point is that at least a
couple of things visibly animate from produced sheets rather than being static.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The city's atmospheric and celebratory effects are **particle systems** you author with
`particle-2d` and **play live** — not flat tints or hand-coded effects. `particle-2d`
authors a system (emitters, forces, per-particle size/opacity/color curves) whose
`render` step writes a **`system.json`**; land them under, for example, `assets/fx/`.
Produce at least:

- **Pollution haze** — a slow, drifting, **settling** smog in the pollution color
  (`specs/overview.md`), the overlay for dirty air over industry and heavy traffic.
- **Construction dust** — a short **one-shot** puff thrown when a lot is developing/being
  built (`specs/map.md`), played at the constructing tile.
- **Milestone fireworks** — a **one-shot** celebratory burst for a milestone
  (`specs/flow.md`) — a first rail line, a population threshold, a maxed district.

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency — do **not** fetch or reimplement it). For this 2D
game use its **`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a
parsed `system.json` and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also exported if you would rather composite
the particles yourself.)

**Drive the overlays from the simulation.** The pollution haze is an **overlay driven by
the tile pollution field** (`specs/economy.md`): spawn/scale the effect where pollution
is present and in proportion to how much — heavy industry and a jammed corridor show
thick haze, and it thins as pollution clears. The construction-dust system is a
**one-shot** played at a developing tile's position; the fireworks are a **one-shot**
played on a milestone. Because these are simulated, they vary play to play — that
variation is correct; do not freeze them.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the city's sound with the audio tools and play the resulting `.wav`s via the Web
Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least a **build/place** cue (a stamp/thunk when the
  player lays a road or building), a **notification chime** (a milestone or a completed
  development), and an **alert** (budget or utility trouble) with `sfx-synth` and/or
  `sfx-sample`, and optionally a soft **ambient city hum** loop. `sfx-synth` builds a
  sound from synth voices alone; `sfx-sample` layers over the baked sample pack (browse
  it via `list-samples`) for a richer result — use whichever suits each cue.
- **Music** — produce a **calm ambient city music bed** with `music`: a slow, warm,
  low-key loop under the city — unobtrusive, the kind of bed a builder plays for hours.
  `music` emits both a `.wav` (the ready asset you play) and a `.mid` score alongside it;
  **play the `.wav`** (the `.mid` is a portable companion you may keep but need not use
  for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching event
  — the build cue when the player places something, the chime on a milestone/completed
  development, the alert when the budget or a utility goes critical (`specs/flow.md`,
  `specs/economy.md`) — and loop the music bed and any ambient hum. **Do not autostart
  audio before the player interacts** (browsers block autoplay), and provide a **mute**
  toggle (`specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD/dashboard/overlay
chrome is drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **HUD dashboard** — the top-strip vitals (treasury, per-period balance,
  population, power and water balances, clock/date, speed, alerts) and the bottom-strip
  **RCI demand meters** and **build palette / tool bar** with its cost readout
  (`specs/flow.md`). Its small **icons** may be produced `draw` sprites, but the panels,
  bars, meters, text, and layout are code.
- All **menus, overlays, panels, and state screens** — title, how-to-play, pause,
  bankruptcy (`specs/flow.md`).
- The **data overlays** — the **traffic** (per-link load → gridlock), **utility**
  (served/unserved), and **pollution/land-value** overlays (`specs/controls.md`) are
  drawn in code from the computed simulation fields. (The pollution *haze* is the
  produced particle system; the toggleable analytic overlay coloring tiles is code.)
- **Selection and tool feedback** — the zone/road/rail/utility previews, the placement
  ghost, the hovered-tile cursor, illegal-placement rejection, and the cost readout
  (`specs/controls.md`).
- The **pollution overlay's driving** — the logic that spawns and scales the produced
  haze system from the tile pollution field (the *system* is produced; deciding where
  and how strongly to play it is code).

## Genuinely produce the assets — this is the point of the case

The assets must be **genuinely produced with these tools**. A build that ships
**placeholder rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a
**flat colored fill in place of the produced pollution particles**, **downloaded or
bundled art**, or **silence in place of produced audio** has not done the task, no
matter how good the simulation is — the produced assets are half of what this case
scores (`specs/overview.md`, the Presentation & Assets domain). Produce real pixel-art
sprites (buildings per tier, transit and utility tiles, vehicles, icons), real animated
sheets, real simulated particle overlays, and real sound and music with the six tools,
and wire those produced files into the game. Everything the game shows and plays should
trace back either to a file you produced with a tool here, or to HUD/overlay/menu chrome
you drew in code as listed above.

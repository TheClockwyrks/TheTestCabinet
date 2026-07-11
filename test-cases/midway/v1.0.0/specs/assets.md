# Midway — Assets you produce (the production contract)

Midway ships with **no** pre-made art, effects, or sound. Instead, the run image
puts six **asset-generation tools** on your `PATH` to help you make them, and **you
must produce every asset the game plays — with those tools or any other way you
prefer — and commit the produced files**, then wire them into the game. Produce
them as a one-time step: your build (`npm run build`) must be **self-contained**,
bundling the committed files without invoking the tools, which are on your
`PATH` only while this run is live — not when the build is re-run to validate
it or rebuilt from the published source. This is the defining requirement of the
case: you are the artist, the VFX author, and the sound designer as well as the
engineer. This file is
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
| `draw` | one sprite → a PNG | path/ground tiles, ride & stall sprites, scenery, HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the guest and ride animations |
| `particle-2d` | a particle system → a `system.json` | fireworks, stall steam, ride sparkle, litter puffs |
| `sfx-synth` | a procedural sound → a `.wav` | coin / ding / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer purchase / ride / alarm cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the cheerful carnival bed |

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
  `/assets/path.png`). It ignores the page's location, resolves against the origin
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

## Sprites — `draw` (tiles, rides, stalls, scenery, icons)

Produce a **single PNG per sprite** with `draw`, on a small transparent (straight-
alpha) canvas — **24×24** matches the tile size (multi-tile rides/stalls are drawn as
larger sprites sized to their footprint, e.g. a few tiles square; icons may be
smaller, e.g. **16×16** or **20×20**). These are **pixel art**: draw at the sprite's
native size and sample it with **nearest-neighbor** in the game
(`imageSmoothingEnabled = false` for Canvas, `image-rendering: pixelated` for DOM) so
it stays crisp. Land them under `assets/` in a sensible layout (for example
`assets/tiles/`, `assets/rides/`, `assets/stalls/`, `assets/scenery/`,
`assets/icons/`).

Produce at least these, in the palette from `specs/overview.md`:

- **Ground & path tiles** — so the park reads at a glance (`specs/park.md`): **grass**,
  **water/pond**, the **fence** and **entrance gate**, and the **paved path** — with
  the path tile drawn so it **tiles flush** into runs (a straight, and ideally a corner
  / junction, so laid paths connect cleanly rather than showing seams).
- **Rides** — the **carousel**, the **coaster** (its station and/or a track piece), and
  the **drop tower** (`specs/rides.md`), each sized to its footprint. A ride sprite is
  the static structure; its motion is the produced animation (below), so draw the parts
  that move as a separate animated sheet if that reads best.
- **Stalls** — the **food stall**, **drink stall**, **souvenir stall**, and
  **restroom** (`specs/rides.md`), each reading clearly as what it sells.
- **Scenery** — the decorations that lift appeal (`specs/park.md`): at least a **tree**,
  a **flowerbed**, a **bench**, and a **lamp** (a **fountain** is a nice extra).
- **HUD icons** — the small marks the dashboard and palette use: **cash**, **guest**,
  **rating/star**, **happiness**, **thrill**, **hunger**, **thirst**, **bladder**,
  **litter**, **alert**, and a tool/build glyph for each palette entry
  (`specs/flow.md`, `specs/controls.md`). These sit inside the in-code HUD.

## Animations — `draw-sheet` (guests and rides)

Produce the moving things with `draw-sheet`, which emits **one PNG per frame**. Two
families of animation are required; land them under, for example,
`assets/guest/walk/`, `assets/guest/happy/`, `assets/ride/carousel/`, one PNG per
frame.

- **Guests** — the crowd is the life of the park, so guests are animated, not static
  dots. Produce a side-or-top **walk** cycle and, crucially, **state variants** that
  read the guest's mood and action at a glance: at least a **happy** walk/idle, an
  **angry** walk/idle, and an **eating** pose (`specs/guests.md`). This is a real
  generalization test — the same little figure believably walking, beaming, fuming, and
  eating. It is fine to reuse a body and recolor/repose per state; the point is that a
  glance at the crowd reads its mood.
- **Rides** — each ride's motion is a produced animation played while it runs
  (`specs/rides.md`): the **carousel spinning**, the **coaster car** moving along its
  station/track, and the **drop tower** car rising and dropping. Play the matching
  animation while a ride is loading/running and freeze or idle it when the ride is
  stopped or broken, so a running ride is visibly alive and a broken one visibly dead.

In the game, **play the matching frames for what the thing is doing**, advancing frames
on a timer so the motion reads (a walk of several frames looping, a carousel spin
looping while it runs, etc.). Draw guests at a size that fits comfortably on a path
tile (the guest color from `specs/overview.md`); you may produce staff as their own
small sprites/sheets so a worker reads as distinct from a guest (`specs/staff.md`).

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The park's celebrations, vents, and puffs are **particle systems** you author with
`particle-2d` and **play live** — not flat shapes or hand-coded effects. `particle-2d`
authors a system (emitters, forces, per-particle size/opacity/color curves) whose
`render`/emit step writes a **`system.json`**; land them under, for example,
`assets/fx/`. Produce at least:

- **Fireworks** — a celebratory burst played over the park at a milestone (a new ride
  open, a 5-star day, a big-guest-count moment; `specs/flow.md`), in bright festival
  colors.
- **Stall steam** — a small looping vent of steam/aroma over a **running food or drink
  stall** (`specs/rides.md`), so an active stall reads.
- **Ride sparkle** — a light effect at a **running ride** (sparks off the coaster,
  lights on the carousel — your call), so a running ride is visibly livelier than a
  stopped one.
- **Litter / cleanup puff** — a short one-shot puff thrown when a **janitor clears
  litter** (or when litter is dropped), tying the cleanup to something you can see
  (`specs/staff.md`).

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency — do **not** fetch or reimplement it). For this 2D
game use its **`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a
parsed `system.json` and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also exported if you would rather
composite the particles yourself.)

**Drive the effects from the simulation.** The steam and ride-sparkle systems are
**looping overlays played at running stalls and rides** — play them where and while the
attraction is active, and stop them when it is idle or broken. The fireworks and the
litter puff are **one-shots** played at the moment and place they belong (a milestone
over the park; a cleanup at the cleared tile). Because these are simulated, they vary
play to play — that variation is correct; do not freeze them.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the park's sound with the audio tools and play the resulting `.wav`s via the
Web Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least a **purchase / coin** cue (a ride ticket or a
  stall sale), a **ride ding / bell** (a ride starting), and a **low-cash or
  ride-broken alarm** with `sfx-synth` and/or `sfx-sample`, and optionally a soft
  **crowd or ride hum** loop. `sfx-synth` builds a sound from synth voices alone;
  `sfx-sample` layers over the baked sample pack (browse it via its `--help`) for a
  richer result — use whichever suits each cue.
- **Music** — produce a **cheerful carnival music bed** with `music`: a bright, bouncy
  fairground loop under the park. `music` emits both a `.wav` (the ready asset you play)
  and a `.mid` score alongside it; **play the `.wav`** (the `.mid` is a portable
  companion you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching
  event — the coin cue on a purchase, the ding when a ride starts, the alarm when cash
  goes critical or a ride breaks (`specs/flow.md`) — and loop the music bed and any
  ambient hum. **Do not autostart audio before the player interacts** (browsers block
  autoplay), and provide a **mute** toggle (`specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD/dashboard chrome is
drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **HUD dashboard** — the top-strip vitals (cash and trend, guest count,
  rating, happiness, day, speed, alerts) and the bottom-strip **build palette / tool
  bar** and the **context panel** (attraction price/queue/takings, guest inspector,
  staff roster; `specs/flow.md`). Its small **icons** may be produced `draw` sprites,
  but the panels, bars, meters, stars, text, and layout are code.
- All **menus, overlays, panels, and state screens** — title, how-to-play, pause,
  park-closed (`specs/flow.md`).
- **Tool and selection feedback** — the path-drag preview, build ghosts (legal/illegal
  tint), the hovered-tile cursor, selection highlight, and price/inspect panels
  (`specs/controls.md`).
- **The queues and crowd density read** — the count/line at a ride and any heat/route
  indicators are code; the guests themselves are produced sprites.

## Genuinely produce the assets — this is the point here

The assets must be **genuinely produced with these tools**. A build that ships
**placeholder rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a
**flat colored puff in place of the produced particles**, **downloaded or bundled
art**, or **silence in place of produced audio** has not done the task, no matter how
good the simulation is — the produced assets are half of what this build is about
(`specs/overview.md`, the Presentation & Assets domain). Produce real pixel-art
sprites, real animated guest and ride sheets, real simulated particle effects, and real
sound and music with the six tools, and wire those produced files into the game.
Everything the game shows and plays should trace back either to a file you produced
with a tool here, or to HUD/menu chrome you drew in code as listed above.

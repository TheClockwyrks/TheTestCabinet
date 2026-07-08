# Holdfast — Assets you produce (the production contract)

Holdfast ships with **no** pre-made art, effects, or sound. Instead, the run image puts
six **asset-generation tools** on your `PATH`, and **you must produce every asset the
game plays with those tools, during this build**, then wire the produced files into the
game. This is the defining requirement of the case: you are the artist, the VFX author,
and the sound designer as well as the engineer. This file is the contract — what to
produce, which tool makes it, where it lands, and how it is wired in. **Read it as
carefully as the simulation specs.**

Every measurement and color here is consistent with `specs/overview.md` (the palette and
coordinate system) and the system specs; when this file gives a value it matches them.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so all UI/HUD chrome is drawn **in code**
(below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | terrain tiles, resource nodes, structures, item and HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the settlers' and raiders' animations |
| `particle-2d` | a particle system → a `system.json` | muzzle flash, blood/impact, fire, explosion, construction dust |
| `sfx-synth` | a procedural sound → a `.wav` | gunshot / hit / build / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer gunshot / hit / build / alarm cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the ambient / tension music bed |

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is the
tool's own help, not restated here. In outline, each tool **records the operations you
run into a log and then renders or emits the finished file**: you initialize it, issue
the drawing / authoring operations, and render/emit the output, writing the finished file
into your project under **`assets/`**. Consult each tool's `--help` for the exact
initialize / operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …). `draw-sheet` is `draw`
  plus a `--frame <index>` on every operation, emitting **one separate PNG per frame**
  (frames are separate files, never regions of one image).
- `particle-2d` authors a **system** — emitters, forces, and per-particle curves — that
  is **simulated live**; its `render`/emit step writes the `system.json` that is the
  asset. You do **not** place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or sequenced
  notes and render a PCM `.wav`; `music` also emits a portable `.mid` score alongside its
  `.wav`. `sfx-sample` and `music` draw on a **baked sample pack / instrument bank**
  already in the image (browse it via the tool's help); a synth from `sfx-synth` needs no
  pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the build
itself does. The built site is **not guaranteed to be served from the root of its
origin** — when it is played back it is mounted under a **per-run sub-path** (a path like
`/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/soil.png`). It ignores the page's location, resolves against the origin root,
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

## Sprites — `draw` (terrain, nodes, structures, items, icons)

Produce a **single PNG per sprite** with `draw`, on a small transparent (straight-alpha)
canvas — **32×32** is a good tile/sprite size (icons may be smaller, e.g. **16×16** or
**24×24**). These are **pixel art**: draw at the sprite's native size and sample it with
**nearest-neighbor** in the game (`imageSmoothingEnabled = false` for Canvas,
`image-rendering: pixelated` for DOM) so it stays crisp. Land them under `assets/` in a
sensible layout (for example `assets/terrain/`, `assets/nodes/`, `assets/structures/`,
`assets/items/`, `assets/icons/`).

Produce at least these, in the palette from `specs/overview.md`:

- **Terrain** — the ground the world is made of, so it reads at a glance
  (`specs/world.md`): **soil** (bare ground), **grass / fertile ground**, and **rock /
  impassable outcrop**, plus the built **floor** (`specs/economy.md`). Tiling terrain
  should sit flush against its neighbors.
- **Resource nodes** — the **tree** (forest node) and the **ore vein**
  (`specs/world.md`), each clearly distinct from bare ground so a gatherable reads
  immediately.
- **Structures** — the **wall**, **door**, **bed**, **stove**, **farm plot** (empty and,
  if you draw growth stages, ripening), and **turret** (`specs/economy.md`,
  `specs/combat.md`). A structure that has a working/idle state — the turret firing, the
  stove cooking — should read as active vs. idle (either a running variant, or let the
  effect/glow carry it).
- **Item icons** — the stockpile/hauled marks for **wood**, **ore**, **crops**, and
  **meals** (`specs/economy.md`).
- **HUD icons** — the small marks the dashboard and palette use: **wood**, **ore**,
  **food/meals**, **settler**, **raider/threat**, **alert**, and a tool/building glyph
  for each palette entry (`specs/flow.md`, `specs/controls.md`). These sit inside the
  in-code HUD.

## Animations — `draw-sheet` (settlers and raiders)

Produce the settlers' and raiders' animations with `draw-sheet`, which emits **one PNG
per frame**. The people on the map are the things that must feel **alive**, so they are
animated, not static sprites. Produce at least these cycles for the **settler**, and at
least a walk and a fight cycle for the **raider** (land them under, for example,
`assets/settler/walk/`, `assets/settler/work/`, `assets/settler/fight/`,
`assets/settler/downed/`, `assets/raider/walk/`, `assets/raider/fight/`, one PNG per
frame):

- **Walk** — a top-down walk cycle (produce the facing(s) you need; you may produce one
  facing and **mirror** or **rotate** it in code, or produce several).
- **Work** — a chopping/mining/building motion, played while a settler works a node or a
  build (`specs/world.md`, `specs/economy.md`).
- **Fight** — a shooting/firing pose, played while a settler or raider is in combat
  (`specs/combat.md`).
- **Downed** — a fallen/collapsed frame for a downed (bleeding-out) settler
  (`specs/combat.md`).

In the game, **play the matching cycle for what the character is doing**, advancing
frames on a timer so the motion reads (a walk of several frames looping, a work swing
looping while chopping, etc.). Draw the settler in the colonist color and the raider in
the hostile color with a distinct silhouette (`specs/overview.md`), at a size that fits
comfortably in a tile. It is fine to reuse a body across cycles; the point is that the
settlers and raiders visibly walk, work, fight, and fall.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The combat flashes, the impacts, the fire, and the work puffs are **particle systems**
you author with `particle-2d` and **play live** — not flat flashes or hand-coded bursts.
`particle-2d` authors a system (emitters, forces, per-particle size/opacity/color curves)
whose `render`/emit step writes a **`system.json`**; land them under, for example,
`assets/fx/`. Produce at least:

- **Muzzle flash** — a short, bright one-shot at a shooter's barrel when it fires
  (`specs/combat.md`), in the power/warm color.
- **Blood / impact** — a one-shot spray when a shot **hits** a target (`specs/combat.md`)
  — the medical/blood color for a hit person, a duller impact for a wall or turret.
- **Fire spread** — a looping flame effect for something burning (a struck structure, an
  explosion's aftermath, or a hazard you introduce), rising and flickering.
- **Explosion** — a one-shot burst for a heavier hit (a destroyed turret, an explosive
  raider, or a similar beat) — a fast expanding puff of smoke and sparks.
- **Construction / impact dust** — a short one-shot puff thrown when a node is worked or
  a build completes (`specs/world.md`, `specs/economy.md`).

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency — do **not** fetch or reimplement it). For this 2D
game use its **`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a
parsed `system.json` and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also exported if you would rather composite
the particles yourself.)

**Drive the effects from the simulation.** The one-shots — muzzle flash, blood/impact,
explosion, construction dust — are **spawned at an event's position** (a shot fired, a
hit landed, a build finished) and play out once. The looping effects — fire — are
**played while their condition holds** (something is burning) and stop when it clears.
Because these are simulated, they vary play to play — that variation is correct; do not
freeze them.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the colony's sound with the audio tools and play the resulting `.wav`s via the
Web Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least a **gunshot** cue, a **hit/impact** cue, a
  **build/place** cue, and a **raid-alarm** cue with `sfx-synth` and/or `sfx-sample`, and
  optionally a soft **turret hum** or **ambient wind** loop. `sfx-synth` builds a sound
  from synth voices alone; `sfx-sample` layers over the baked sample pack (browse it via
  its `--help`) for a richer result — use whichever suits each cue.
- **Music** — produce an **ambient / tension music bed** with `music`: a low, sparse
  frontier atmosphere under the colony that **lifts into tension when a raid lands**
  (`specs/flow.md`) — you may produce one bed and filter/duck it, or produce a calm bed
  and a tense bed and cross-fade between them. `music` emits both a `.wav` (the ready
  asset you play) and a `.mid` score alongside it; **play the `.wav`** (the `.mid` is a
  portable companion you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching event
  — the gunshot when a shot fires, the hit cue when a shot lands, the build cue on a
  completed build, the alarm when a raid is announced (`specs/combat.md`,
  `specs/flow.md`) — and loop the music bed and any ambient/turret loop. **Do not
  autostart audio before the player interacts** (browsers block autoplay), and provide a
  **mute** toggle (`specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD/dashboard chrome is
drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **HUD dashboard** — the top-strip vitals (stocks, colony state, day/time
  clock, speed, and the raid warning) and the bottom-strip **settler roster** and **build
  palette / tool bar** (`specs/flow.md`) — and the **work-priority grid** panel
  (`specs/controls.md`). Its small **icons** may be produced `draw` sprites, but the
  panels, bars, meters, grid, text, and layout are code.
- All **menus, overlays, panels, and state screens** — title, how-to-play, pause,
  colony-lost (`specs/flow.md`).
- **Selection and tool feedback** — chop/mine designations, build ghosts, the
  hovered-tile cursor, cover indicators, priority marks (`specs/controls.md`).
- The **day/night lighting** — the cooling, dimming overlay that reads the hour
  (`specs/time.md`) — and the driving of the produced effects (the *systems* are
  produced; deciding where and when to play them is code).

## Genuinely produce the assets — this is the point of the case

The assets must be **genuinely produced with these tools**. A build that ships
**placeholder rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a
**flat colored flash in place of the produced particles**, **downloaded or bundled art**,
or **silence in place of produced audio** has not done the task, no matter how good the
simulation is — the produced assets are half of what this case scores
(`specs/overview.md`, the Presentation & Assets domain). Produce real pixel-art sprites,
real animated settler and raider sheets, real simulated particle effects, and real sound
and music with the six tools, and wire those produced files into the game. Everything the
game shows and plays should trace back either to a file you produced with a tool here, or
to HUD/menu chrome you drew in code as listed above.

# Deepcore — Assets you produce (the production contract)

Deepcore ships with **no** pre-made art, effects, or sound. Instead, the run image
puts six **asset-generation tools** on your `PATH` to help you make them, and **you
must produce every asset the game plays — with those tools or any other way you prefer
— and commit the produced files**, then wire them into the game. Produce them as a
one-time step: your build (`npm run build`) must be **self-contained**, bundling the
committed files without invoking the tools, which are on your `PATH` only while this
run is live — not when the build is re-run to validate it or rebuilt from the
published source. This is the defining requirement of the case: you are the character
animator, the environment artist, the VFX author, and the sound designer as well as
the engineer. This file is the contract — what to produce, which tool makes it, where
it lands, and how it is wired in. **Read it as carefully as the simulation specs.**

Every measurement and color here is consistent with `specs/overview.md` (the palette
and coordinate system) and the system specs; when this file gives a value it matches
them.

> **The animated miner is the headline.** This case is judged as much on its **produced
> character animation** — the prospector's idle, walk, drill, jetpack, fall, hurt, and
> out-of-fuel cycles — as on its simulation (`specs/overview.md`, the Presentation &
> Character Animation domain). Read the sprite-sheet section as the centerpiece of this
> file, not an afterthought. A stiff, single-frame miner is a failed build.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so all HUD, panel, and menu chrome is
drawn **in code** (below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | the tiles, ore veins, materials, hazards, buildings, the rocket, HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the **miner's animation cycles** (the headline), the lava shimmer, the rocket-assembly stages |
| `particle-2d` | a particle system → a `system.json` | the VFX — drill debris, jetpack exhaust, gas explosion, lava embers, ore sparkle, material shimmer, core extraction + detonation, launch exhaust, death burst |
| `sfx-synth` | a procedural sound → a `.wav` | drill / thrust / pickup / explosion / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer impact / pickup / fabricate / launch cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the lonely descent music bed |

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is
the tool's own help, not restated here. In outline, each tool **records the operations
you run into a log and then renders or emits the finished file**: you initialize it,
issue the drawing / authoring operations, and render/emit the output, writing the
finished file into your project under **`assets/`**. Consult each tool's `--help` for
the exact initialize / operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …). `draw-sheet` is `draw`
  plus a `--frame <index>` on every operation, emitting **one separate PNG per frame**
  (frames are separate files, never regions of one image).
- `particle-2d` authors a **system** — emitters, forces, and per-particle curves —
  that is **simulated live**; its `render`/emit step writes the `system.json` that is
  the asset. You do **not** place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or
  sequenced notes and render a PCM `.wav`; `music` also emits a portable `.mid` score
  alongside its `.wav`. `sfx-sample` and `music` draw on a **baked sample pack /
  instrument bank** already in the image (browse it via the tool's help); a synth from
  `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the
build itself does. The built site is **not guaranteed to be served from the root of
its origin** — when it is played back it is mounted under a **per-run sub-path** (a
path like `/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/miner.png`). It ignores the page's location, resolves against the origin
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

## The animated miner — `draw-sheet` (THE HEADLINE)

**The miner's animation is what this case measures.** Produce the prospector as a set
of **sprite-sheet cycles** with `draw-sheet` — one PNG per frame — one cycle per
animation state in `specs/character.md`, and play the matching cycle for whatever the
miner is doing, advancing frames on a timer so the motion reads. This is half of what
the build is scored on; treat it as first-class engineering.

The miner is a **suited character** with a handheld **drill** and a back **jetpack**,
drawn to fit within a single **`80 x 80` tile** (a little headroom is fine). Draw it
facing **one canonical direction** (for example facing `+x`, "east") and **mirror it in
the game** to face the other way, so left/right facing is consistent. Produce **at
least** these cycles, each a short sequence of frames (land them under, for example,
`assets/miner/<state>/`, one PNG per frame):

| Cycle | Frames (guide) | Character it must carry |
| --- | --- | --- |
| **idle** | 2–4, slow | standing at rest — a breathing bob and a lamp flicker so the miner is alive |
| **walk** | 4–8 | a readable walk cycle on the ground, legs and drill swinging |
| **drill-down** | 3–6, looping | braced downward, the drill biting the floor, the body shaking with the cut |
| **drill-side** | 3–6, looping | braced sideways, the drill biting the wall ahead |
| **jetpack** | 3–6, looping | thrusting up — the jetpack firing, the body lifted, a flame flicker at the nozzle |
| **fall** | 2–3 | dropping through open tunnel, arms and legs trailing |
| **hurt** | 2–4, one-shot | a sharp flinch/recoil at the instant of damage — unmistakably "took a hit" |
| **fuel-out** | 2–3 | a slumped, powerless pose, jetpack dead — the fail-state read |

The animation must **escalate the sense of effort** across states — the idle is
gentle, the drill shakes, the jetpack strains, the fall is limp, the hurt snaps — so
the character reads as genuinely *doing* each thing. Keep the silhouette and the
suit/drill/jetpack details consistent across every cycle so it is always the same
prospector. A believable, characterful miner across this full set is the single most
important produced asset in the build.

## Environment sprites — `draw` (tiles, ore, materials, hazards, buildings, rocket)

Produce a **single PNG per sprite** with `draw`, on a transparent (straight-alpha)
canvas at the sprite's native size, sampled **nearest-neighbor** in the game
(`imageSmoothingEnabled = false` for Canvas, `image-rendering: pixelated` for DOM) so
it stays crisp. **Produce each sprite at the size it is drawn at** — a tile is `80 x 80`,
so tiles, ore/material overlays that lay over a tile, and hazard tiles are all `80 x 80`;
do **not** author at a smaller size and let the engine upscale (that is blurry/blocky).
Icons are smaller (`16–24 px`). Land them under `assets/` in a sensible layout (for
example `assets/tiles/`, `assets/ore/`, `assets/materials/`, `assets/hazards/`,
`assets/surface/`, `assets/icons/`).

Produce at least these, in the palette from `specs/overview.md`:

- **Band rock tiles** — tileable rock tiles per band so the depth reads at a glance
  (`specs/world.md`): **topsoil** earth, **rockbed** grey stone, **deepstone** near-black
  rock, and **coreshell** red-glowing rock, plus the unminable **bedrock border** tile.
  Produce **several variants (at least three) of each band's rock tile** and have the
  renderer pick one per cell (e.g. a stable hash of the cell's row/col), so a wall of the
  same band does **not visibly repeat a single texture** — the mine should read as
  natural, varied ground, not a grid of one identical stamp. The variants share the
  band's fill and palette; only the clump/crack/fleck layout differs. The texture must be
  **roughly uniform dirt/rock** — a fine, even grain filling the whole tile — **not a few
  large clear blotches** that make the ground look patchy and off (a common failure);
  Motherload's dirt reads as dirt precisely because it is even. The faint tile grid is
  drawn in code over them.
- **Unbreakable stone** — the **boulder** tile (`specs/world.md`): a hard, cold,
  **smooth** dark stone (a couple of variants) that reads clearly as a **different, harder
  material** than the grainy band dirt around it, so the player sees at a glance that the
  drill will not break it. Distinct silhouette (rounded/riveted boulder, a cool steely
  grey) — never just a re-tinted dirt tile.
- **Tunnel + dirt lip (drawn in code).** The carved-out **empty** cell is **not** a plain
  square: it is rendered **inset with a dirt lip and rounded corners** (`specs/world.md`)
  so a tunnel is slightly narrower than a full tile and adjacent open cells join while
  diagonally-touching ones stay separate. This inset/rounded shaping is done **in code**
  over the produced band-dirt tile (the lip is real band dirt showing through); produce
  the **dark tunnel-interior fill** sprite (and optionally a subtle rubble texture) that
  the code paints inside the carved shape.
- **Drill-damage overlay** — a produced **crack sheet** (`draw-sheet`, one PNG per frame;
  see the animations section) drawn over the tile currently being drilled, its frame
  deepening with the cut so the dig visibly progresses (`specs/character.md`). A
  transparent `80 x 80` overlay: light hairline cracks in the first frame through a
  shattered, about-to-break face in the last.
- **Ore veins** — a transparent overlay for each of the six ores (**Ferron, Cuprite,
  Argenite, Voltite, Pyronium, Adamite**, `specs/mining.md`) laid over the band rock,
  each reading clearly as its ore by color and glint so a vein stands out from plain
  rock. Draw each as a **smear of mineral run through the dirt** — a streak that spreads
  across much of the tile, feathers into the surrounding rock at the edges (transparent
  gaps let the band rock show through, so the ore reads as mixed *into* the dirt), and
  reaches the tile's edges so adjacent ore cells read as one continuous vein. This is the
  Motherload look; do **not** draw an ore as a discrete nugget or a couple of dots
  sitting on top of the rock. Each ore still keeps its own character on the smear
  (Ferron flecky, Cuprite nodular, Argenite seamy, Voltite crystalline, Pyronium
  glowing, Adamite a rare bright gem — `specs/mining.md`).
- **Material nodes** — a distinct tile for **Resonite** (blue crystal) and **Cryenite**
  (violet crystal) embedded in rock (`specs/mining.md`), unmistakably richer and rarer
  than an ore vein, plus the glowing **Core** in its chamber and the **Core Sample**
  icon it yields.
- **Hazards** — the **lava** tile (molten orange; see the lava shimmer under animations),
  drawn **fringed with the band's dirt** at the cell edges (the dirt border is shaped in
  code, like the tunnel lip, so lava meets rock through dirt, not a hard square seam, and
  adjacent lava cells flow into one pool — `specs/world.md`, `specs/hazards.md`). There is
  **no distinct gas-pocket tile**: a gas pocket is drawn with the **same band rock** as
  ordinary ground (`specs/world.md`) and betrayed only by the subtle **gas seep** particle
  effect below — so gas is hidden, unlike the plainly-visible lava.
- **Surface buildings** — the four camp structures (`specs/world.md`): the **Fuel
  Depot**, the **Ore Market**, the **Upgrade Shop**, and the **Launch Pad**, each
  reading clearly as what it is, sitting on the scrapped surface ground under the dusk
  sky, plus the **cave mouth** down into the mine.
- **The escape rocket** — the rocket on the pad (`specs/rocket.md`). Draw it so it
  **visibly gains each installed component** — either as **assembly-stage frames** (a
  `draw-sheet` set: bare pad → frame → +fuel cells → +guidance → +thruster → +ignition,
  a lit, launch-ready rocket) or as layered per-component sprites the renderer stacks.
  The growing rocket is the player's win-progress read and a bespoke centerpiece asset.
- **HUD icons** — the small marks the status bar uses (`specs/flow.md`): **Fuel**,
  **Hull**, **Cargo**, **Credits**, **Depth**, and a glyph for each material in the
  satchel. `16–24 px`, sitting inside the in-code HUD.

## Animations — `draw-sheet` (lava shimmer, rocket assembly)

Beyond the miner cycles above, use `draw-sheet` for the small environment motions that
keep the world alive:

- **Lava shimmer** — a short looping cycle for the lava tile so molten rock glows and
  churns rather than sitting as a flat orange square (`specs/hazards.md`). The dirt fringe
  around the lava is shaped in code (above); the shimmer frames are the molten interior.
- **Drill-damage crack overlay** — a **short progression** of transparent `80 x 80`
  frames (e.g. 4), from faint hairline cracks to a shattered, about-to-break face, drawn
  over the tile currently being drilled with the frame chosen by drill progress
  (`specs/character.md`, `specs/world.md`). Not a loop — it reads front-to-back as the cut
  deepens.
- **Rocket assembly** — if you take the frame-based approach above, the assembly-stage
  set is a `draw-sheet` (one frame per completed-component state), selected by how many
  components are installed (`specs/rocket.md`).

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The world's effects are **particle systems** you author with `particle-2d` and **play
live** — simulated effects that vary shot to shot, **not** flat flashes or hand-coded
loops. `particle-2d` authors a system (emitters, forces, per-particle
size/opacity/color curves) whose `render`/emit step writes a **`system.json`**; land
them under, for example, `assets/fx/`. Produce **at least** these, each firing at the
event and position named:

| Effect | Fires when | Character it must carry |
| --- | --- | --- |
| **Gas seep** | ambient, over an **on-screen gas pocket** (`specs/hazards.md`) | a **very subtle**, sparse wisp of pale-green gas rising from the tile — the *only* tell that hidden gas is there; faint enough that a hurried dig misses it, noticeable to a careful eye |
| **Drill debris** | the miner is **drilling** a tile (`specs/character.md`) | a spray of rock chips / dust off the bit, tinted to the band being dug |
| **Jetpack exhaust** | the miner **thrusts** (`specs/character.md`) | a downward plume of hot exhaust and sparks under the jetpack, pulsing with the hold |
| **Ore sparkle** | an **ore vein** is collected (`specs/mining.md`) | a brief bright glint at the pickup, tinted to the ore |
| **Material shimmer** | a **Resonite/Cryenite node** is collected (`specs/mining.md`) | a richer, distinct shimmer — this is a prize, not routine ore |
| **Gas explosion** | a **gas pocket** detonates (`specs/hazards.md`) | a violent green-white burst and flying debris — the "you hit gas" read |
| **Lava embers** | the miner **touches lava** (`specs/hazards.md`) | a sizzle of embers and smoke at the contact point |
| **Impact dust** | the miner **lands hard** (`specs/hazards.md`) | a puff of dust on a hard touchdown |
| **Core extraction** | the **Core Sample** is taken (`specs/hazards.md`) | an ominous pulse of energy off the core as the timer starts |
| **Core detonation** | the Core Sample timer **expires** (`specs/hazards.md`) | a huge, violent explosion — much larger than a gas blast; the lethal climax |
| **Launch exhaust** | the rocket **launches** (`specs/rocket.md`) | a roaring column of exhaust and smoke as the rocket lifts off — the victory payoff |
| **Death burst** | the miner **dies** (`specs/character.md`, `specs/modes.md`) | a burst marking the death (suit venting / debris) |

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency — do **not** fetch or reimplement it). For this 2D
game use its **`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a
parsed `system.json` and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also exported if you would rather
composite the particles yourself.)

**Fire the bursts from the simulation.** Spawn an instance of the matching system **at
the event's position** — the drill debris at the bit, the exhaust under the jetpack,
the sparkle at a pickup, the gas blast at the pocket, the detonation at the miner, the
launch exhaust under the rocket — and let it play out. Because these are simulated,
they **vary shot to shot** — that variation is correct; do not freeze them into a
single canned frame, and do not substitute a flat opacity flash for the produced
system.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the mine's sound with the audio tools and play the resulting `.wav`s via the
Web Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least: a **drill loop** (grinding while digging), a
  **jetpack thrust loop** (a burner while thrusting), an **ore pickup** blip, a
  **material chime** (richer, for a Resonite/Cryenite find), a **gas explosion**, a
  **lava sizzle**, an **impact thud** (hard landing), a **purchase/fabricate** confirm
  (upgrade or rocket part), a **launch roar**, a **death** cue, and the two **alarms** —
  the **low-fuel** warning and the escalating **core-timer** countdown beep
  (`specs/character.md`, `specs/hazards.md`, `specs/flow.md`), with `sfx-synth` and/or
  `sfx-sample`. `sfx-synth` builds a sound from synth voices alone; `sfx-sample` layers
  over the baked sample pack (browse it via its `--help`) for a richer result — use
  whichever suits each cue.
- **Music** — produce a **lonely, industrial descent bed** with `music`: a low,
  atmospheric loop that suits a solitary miner far underground. `music` emits both a
  `.wav` (the ready asset you play) and a `.mid` score alongside it; **play the `.wav`**
  (the `.mid` is a portable companion you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching
  event — the drill loop while digging, the thrust loop while thrusting, the pickup on
  ore, the chime on a material, the explosion on gas, the sizzle on lava, the confirm on
  a buy/fabricate, the roar on launch, and the alarms on low fuel and the core timer —
  and loop the music bed. **Do not autostart audio before the player interacts**
  (browsers block autoplay), and provide a **mute** toggle (`specs/controls.md`,
  `specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD, panel, and menu
chrome is drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **status bar** — the Fuel / Hull / Cargo gauges, Credits, the Depth
  readout, the materials satchel, and the pause/mute controls (`specs/flow.md`). Its
  small **icons** may be produced `draw` sprites, but the bars, text, and layout are
  code.
- The **scanner indicator** — the directional arrow and distance to the nearest needed
  material, drawn in code over the world (`specs/mining.md`).
- The **Core Sample countdown** — the prominent timer readout while carrying the Core
  Sample (`specs/hazards.md`).
- All **surface building panels** — Fuel Depot, Ore Market (cargo breakdown + SELL),
  Upgrade Shop (the seven tracks + prices), and Launch Pad (the rocket checklist +
  FABRICATE / LAUNCH) (`specs/flow.md`, `specs/upgrades.md`, `specs/rocket.md`).
- All **menus, overlays, and state screens** — title, mode select, how-to-play, pause,
  victory, and game over (`specs/flow.md`, `specs/modes.md`).
- **The carved-tunnel and lava shaping** — the **inset dirt lip and rounded corners** of
  a carved tunnel, and the matching **dirt fringe** around a lava tile (`specs/world.md`),
  are computed **in code** from each open/lava cell's neighbors (which sides are open,
  which corners are exterior) and painted over the produced band-dirt tile with the
  produced tunnel-fill / lava-shimmer sprites inside the shaped region. The produced
  sprites supply the *texture*; the code supplies the *shape* that makes tunnels join
  orthogonally, stay separate diagonally, and never meet rock at a hard square seam.
- **The drill-damage overlay** — selecting the crack frame from the current drill's
  progress and compositing it over the tile being cut (`specs/character.md`).
- **The gas seep placement** — firing the subtle gas-seep particle effect over gas
  pockets that are on screen, sparsely, so hidden gas has its faint tell (`specs/hazards.md`).
- **World feedback** — the faint tile grid over the produced rock tiles, the depth-band
  transitions, the retrievable **death cache** marker (`specs/modes.md`), the cargo-full
  note, and any placement/selection cues. The code reads the simulation and draws these
  over the produced sprites.

## Genuinely produce the assets — this is the point here

The assets must be **genuinely produced with these tools**. A build that ships
**placeholder rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a
**single static frame in place of the miner's animation cycles**, a **flat flash in
place of the produced particle systems**, **downloaded or bundled art**, or **silence
in place of produced audio** has not done the task, no matter how good the simulation
is — the produced assets, and above all the **animated miner**, are half of what this
build is about (`specs/overview.md`, the Presentation & Character Animation domain).
Produce a real animated character across every state, real band tiles and ore, real
**simulated** effects, and real sound and music with the six tools, and wire those
produced files into the game. Everything the game shows and plays should trace back
either to a file you produced with a tool here, or to HUD/menu chrome you drew in code
as listed above.

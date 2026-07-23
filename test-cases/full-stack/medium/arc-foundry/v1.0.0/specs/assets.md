# Arc Foundry — Assets you produce (the production contract)

Arc Foundry ships with no pre-made art, effects, or sound. Instead, the run image
puts six asset-generation tools on your `PATH` to help you make them, and you must
produce every asset the game plays (with those tools or any other way you prefer)
and commit the produced files, then wire them into the game. Produce them as a
one-time step: your build (`npm run build`) must be self-contained, bundling the
committed files without invoking the tools, which are on your `PATH` only while this
run is live, not when the build is re-run to validate it or rebuilt from the
published source. This is the defining requirement of the case: you are the artist,
the effects author, and the sound designer as well as the engineer. This file is the
contract: what to produce, which tool makes it, where it lands, and how it is wired
in. Read it as carefully as the simulation specs.

Every measurement and color here is consistent with `specs/overview.md` (the palette
and coordinate system) and the system specs; when this file gives a value it matches
them.

The electrical effects are the headline. This case is judged as much on its produced
particle effects (the arcs, spark showers, chain-lightning, and discharges) as on
its simulation (`specs/overview.md`, the Visuals scoring domain). Read the
particle-systems section as the centerpiece of this file. A flat flash where a
simulated discharge belongs is a failed build.

## The six tools

Exactly these six binaries are on your `PATH`, no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so all HUD, build-panel, and menu
chrome is drawn in code (below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | the yard, entry/collector, components across quality tiers, projectiles, the Load, HUD icons |
| `draw-sheet` | a sprite sheet, one PNG per frame | the enemy charge cycles, component firing cycles, and the press-stamp cycle |
| `particle-2d` | a particle system → a `system.json` | the electrical effects — build spark, combine flash, arc bolts, chain-lightning, spark spray, discharge ring, impacts, deaths, leak alarm, and the status/aura effects (slow, burn, aura) |
| `sfx-synth` | a procedural sound → a `.wav` | stamp / zap / discharge / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer chain / discharge / combine / ground-out cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the industrial-electro reactor bed |

Each is a command-line tool. Run `<tool> --help` to learn its operations (and
`<tool> <operation> --help` for one operation's flags); the operation vocabulary is
the tool's own help, not restated here. In outline, each tool records the operations
you run into a log and then renders or emits the finished file: you initialize it,
issue the drawing / authoring operations, and render/emit the output, writing the
finished file into your project under `assets/`. Consult each tool's `--help` for the
exact initialize / operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …). `draw-sheet` is `draw`
  plus a `--frame <index>` on every operation, emitting one separate PNG per frame
  (frames are separate files, never regions of one image).
- `particle-2d` authors a system (emitters, forces, and per-particle curves) that is
  simulated live; its `render`/emit step writes the `system.json` that is the asset.
  You do not place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or
  sequenced notes and render a PCM `.wav`; `music` also emits a portable `.mid` score
  alongside its `.wav`. `sfx-sample` and `music` draw on a baked sample pack /
  instrument bank already in the image (browse it via the tool's help); a synth from
  `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the
build itself does. The built site is not guaranteed to be served from the root of its
origin: when it is played back it is mounted under a per-run sub-path (a path like
`/runs/<id>/build/`). So:

- Never reference an asset by a root-absolute URL (a leading `/`, such as
  `/assets/capacitor.png`). It ignores the page's location, resolves against the
  origin root, and 404s under a sub-path.
- Reference assets relative to the document or module instead. Prefer letting your
  bundler resolve them: import each PNG / `.wav` / JSON, or use a bundler directory
  glob (for example Vite's `import.meta.glob('../assets/**/*.png', { eager: true,
  query: '?url' })`) and use the URLs it returns. A runtime `new URL('./assets/…',
  import.meta.url)` also works if your bundler can statically resolve it.
- Configure your bundler's base to be relative (for Vite, `base: './'`) so the emitted
  JS, CSS, and asset URLs are all page-relative.

This governs the produced art, the `system.json` files, the `.wav`s, and the bundled
JS/CSS alike. The quickest self-check: serve your `dist/` from a non-root sub-path and
confirm the game loads with no 404s.

## Sprites — `draw` (yard, components, the Load, projectiles, icons)

Produce a single PNG per sprite with `draw`, on a small transparent (straight-alpha)
canvas. These are pixel art: draw at the sprite's native size and sample it with
nearest-neighbor in the game (`imageSmoothingEnabled = false` for Canvas,
`image-rendering: pixelated` for DOM) so it stays crisp. Land them under `assets/` in
a sensible layout (for example `assets/board/`, `assets/components/`,
`assets/projectiles/`, `assets/load/`, `assets/icons/`). Sizes: a
component occupies a 2×2 tile / 40×40 px footprint (`specs/board.md`), a unit suits a
`20×20`–`32×32` sprite, HUD icons may be `16×16` or `24×24`.

Produce at least these, in the palette from `specs/overview.md`:

- Yard: the substrate tile the board is tiled from (dark, oil-stained concrete; the
  faint tile grid is drawn in code over it, `specs/board.md`), the Entry (a blown
  feeder vent, glowing, where the Load spills in) and the Collector (a grounding sink,
  hazard-marked, where units ground out), a small waypoint pylon / checkpoint stud the
  code places at each map's waypoint tiles, and the transformer housing box that fills
  Map C's fixed-blocked tiles (a heavy steel box that reads as impassable,
  `specs/board.md`). The goal is that the yard, its flow direction toward the
  Collector, and each map's waypoints read at a glance.
- Components — 8 base types × 5 quality tiers. Draw each of the eight base component
  types (Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier, and
  Regulator, `specs/towers.md`) at each of the five quality tiers (Scrap → Tuned →
  Charged → Primed → Tesla-Prime), so the quality ladder reads at a glance: the finish
  must escalate every rung, a Scrap component pitted, rusted, dimly flickering; a
  Tesla-Prime mirror-chromed and wreathed in arcs (`specs/towers.md`). A component must
  read as its type and as which quality tier it is. Author each firing component as a
  rotatable head on a fixed base: draw the head pointing in a single canonical
  direction (for example toward `+x`, "east") so the game rotates the whole head to aim
  it at the target (`specs/towers.md`), and produce a separate non-rotatable
  base/mount sprite to sit under it (the head rotates; the base does not). Keep the
  head's canonical facing consistent across a component's five tiers. A base sprite
  plus a produced per-tier finish accent/overlay is an acceptable alternative to wholly
  separate heads, provided each of the five tiers is visibly distinct. The Choke (a
  slow bolt) and the Rectifier (a burn bolt) are ordinary firing components, each a
  rotatable head over a base, across all five tiers. The Regulator is the exception: it
  never fires (`specs/towers.md`), so draw it as a non-firing support sprite, a static
  aura emitter with no rotating firing head and no fire cycle, still across its five
  tier finishes plus a base so its quality still reads.
- Combination towers — 12 unique turrets. Draw each of the roughly twelve combination
  towers (`specs/towers.md`, `specs/build.md`), the upgradeable turrets assembled from
  a recipe. Each is one unique sprite with no quality-tier variants (its upgrade level
  scales stats, not the sprite): a single rotatable head on a fixed base, drawn facing
  the same canonical direction as the base types so the game aims it, plus a fire cycle
  (below). Give each a look that reads its dominant ability and wear the
  combination-tower gold accent (`#ffe9a8`, `specs/overview.md`) so a combo is
  unmistakable next to a base component; a Regulator-derived or aura combo may take an
  aura-emitter look.
- Blocker: the inert fused-scrap rock an unkept rock hardens into at wave start
  (`specs/build.md`): a 2×2 lump that unmistakably reads as dead, no head, no glow,
  just wall. It must never be confused with a firing component or a still-selectable
  candidate. (A candidate, a placed-but-not-yet-kept roll, is drawn from its rolled
  component sprite with a code-drawn "uncommitted" treatment; it needs no separate
  produced sprite.)
- Projectiles: a small traveling shot sprite for each single-bolt component: the
  Capacitor bolt, the Emitter spark, the Discharge Rig heavy slug, a Choke bolt, and a
  Rectifier bolt (`specs/towers.md`), each drawn pointing in the same canonical
  direction as the heads so the game rotates each to its heading as it flies. The
  projectile is the object that carries the hit on impact (`specs/towers.md`), so it
  must be a visible traveling sprite, not a static dot at the muzzle, and not omitted in
  favour of an instant hitscan. (The Regulator does not fire, so it has no projectile;
  the Coil's chain and the Arc-Node's discharge are particle effects, below, they carry
  their hits, not a projectile sprite.)
- The Load: the six enemy types (`specs/enemies.md`): Mote (baseline charge unit),
  Spark (small, fast, fragile), Slug (big, slow, capacitive tank), Cluster (tiny,
  arrives in packs), Filament (the flyer, must read as airborne), and the Dynamo (the
  boss, an unstable overload core, drawn large). Each carries a health bar drawn in code
  over it.
- HUD icons: the small marks the status bar and build panel use (`specs/board.md`,
  `specs/flow.md`): Charge (money), Grid Integrity (lives), and a glyph for each of the
  eight base component types (and optionally one per combination tower), and optionally
  one per Load type for the next-wave preview. These sit inside the in-code HUD, `16–24
  px`.

## Animations — `draw-sheet` (charge cycles, firing cycles, the press stamp)

Produce with `draw-sheet`, which emits one PNG per frame. The yard must feel alive,
not a field of static dots. Produce at least these cycles, each as a short sequence of
frames (land them under, for example, `assets/load/<type>/`,
`assets/components/<type>/`, `assets/fx/press/`, one PNG per frame):

- Enemy charge cycles: a short idle/crackle cycle per Load type so units seethe with
  charge rather than sit static as they crawl the maze. The Dynamo gets a distinct
  unstable-overload wobble/pulse (`specs/enemies.md`) so the boss visibly seethes as it
  is worn down.
- Component firing cycles: a charge-and-discharge cycle per firing component type so a
  firing component animates rather than sitting inert: the Capacitor's charge pulse, the
  Coil's wind-up, the Emitter's rapid flicker, the Arc-Node's ring wind-up, the
  Discharge Rig's bank charge, the Choke's throttle pulse, and the Rectifier's
  overcurrent surge (`specs/towers.md`). Play it when the component fires. The Regulator
  never fires, so it gets no firing cycle; give it instead a slow aura idle pulse (its
  non-firing support animation). Each of the twelve combination towers also gets its own
  firing cycle (an aura-type combo may pulse its aura instead).
- Press-stamp cycle: the scrap-press stamping a component, played on the build panel
  and/or at the stamp site when a component is stamped (`specs/build.md`).

In the game, play the matching cycle for what a unit or component is doing, advancing
frames on a timer so the motion reads. It is fine to reuse a body across tints; the
point is that the Load visibly crackles, firing components visibly charge and
discharge, and the Dynamo visibly seethes.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime` (the headline)

The electrical effects are what this case measures. Every arc, spark shower,
chain-lightning leap, and discharge is a particle system you author with `particle-2d`
and play live, a simulated effect that varies shot to shot, not a flat flash, a canned
frame, or a hand-coded loop. `particle-2d` authors a system (emitters, forces,
per-particle size/opacity/color curves) whose `render`/emit step writes a
`system.json`; land them under, for example, `assets/fx/`. This is half of what the
build is scored on; treat it as first-class engineering.

Produce at least these twelve systems; each entry names when it fires and the
character it must carry:

| Effect | Fires when | Character it must carry |
| --- | --- | --- |
| **Build spark** | a component is stamped from the press (`specs/build.md`) | a bright shower of sparks and a snap of arc at the new footprint — the stamp lands hot |
| **Combine flash** | two components combine into a higher tier (`specs/build.md`) | a brilliant convergent flash / implosion of light as the quality ladder climbs — the payoff read for a combine |
| **Arc bolt fire** | a Capacitor or Discharge Rig fires its single bolt (`specs/towers.md`) | a crackling blue-white bolt trail from head to target; the Discharge Rig's is fatter and more violent than the Capacitor's |
| **Chain-lightning** | a Coil fires and chains (`specs/towers.md`) | forked lightning leaping between each hit unit in the chain, dimming per jump — visibly a chain, not one bolt |
| **Spark spray** | an Emitter fires (rapidly) (`specs/towers.md`) | a fast fan of small sparks toward the target, firing often — reads as the rapid anti-swarm gun |
| **Discharge ring** | an Arc-Node shot lands (`specs/towers.md`) | an expanding ring of electrical discharge over the splash radius — the AoE footprint must read |
| **Spark-burst impact** | any projectile or arc hits a unit | a small burst of sparks at the point of impact |
| **Discharge / death burst** | a unit dies (`specs/enemies.md`) | an electrical pop; the Dynamo's death is a big EMP-style discharge, much larger than a Mote's |
| **Leak alarm** | a unit grounds out at the Collector (`specs/flow.md`) | a warning surge / flare at the sink as Grid Integrity drops — the "you took damage" read |
| **Slow snap** | a Choke or a slow-carrying combo hits a unit (`specs/towers.md`) | a brief frost / EM-drag snap clinging to the slowed unit, in the Choke blue `#66d9e8` — the "it's slowed" read |
| **Burn / DoT** | a Rectifier or a burn-carrying combo hits a unit (`specs/towers.md`) | an ember flare on impact and a low ember-ticking flicker on the unit while the burn keeps ticking, in the Rectifier orange `#ff6b3d` |
| **Aura pulse** | a Regulator or an aura combo sits on the board (`specs/towers.md`) | a slow support pulse ring at the source in the Regulator green `#b6e05a`, marking the aura it projects — it never fires |

crit and multishot (combination-tower abilities, `specs/towers.md`) need no new
particle system: a crit reuses the spark-burst impact at a larger scale (a bigger
burst), and a multishot is simply several normal projectiles fired at once, each
carrying the usual impact burst.

Escalate the firing effects with quality. A firing effect's intensity must scale with
the component's quality tier (`specs/towers.md`) so the ladder reads in the effects,
not only in the sprite: a Scrap Capacitor sputters a thin, dim bolt; a Tesla-Prime one
throws a fat, forking, blindingly bright arc, and the same escalation for the Coil's
chain, the Emitter's spray, the Arc-Node's ring, and the Discharge Rig's crack. This
escalation is a scored expectation, not a nicety. A muzzle glow at a firing head and a
small collector-arc ambience at the sink are welcome extras.

Play them with the provided runtime. `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and
import it like any other dependency; do not fetch or reimplement it). For this 2D game
use its `/canvas` binding, its `ParticleCanvasPlayer`: construct one from a parsed
`system.json` and your 2D canvas context, and advance it each frame with your frame
delta; it simulates the system and composites the particles. The package's own types
are the authoritative API; read them for the exact constructor and update signatures.
(Its pure `ParticleSimulator` is also exported if you would rather composite the
particles yourself.)

Fire the bursts from the simulation. Spawn an instance of the matching system at the
event's position: the build spark at the stamped footprint, the combine flash where
the two components converge, the arc bolt along the line from the firing head to its
target, the chain-lightning threaded through each unit the Coil's bolt jumps to, the
discharge ring centered on the Arc-Node's impact point, the impact burst where a shot
connects, the death discharge where a unit dies, and the leak alarm at the Collector,
and let it play out. Because these are simulated, they vary shot to shot; that
variation is correct. Do not freeze them into a single canned frame, and do not
substitute a flat opacity flash for the produced system.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the yard's sound with the audio tools and play the resulting `.wav`s via the
Web Audio API. Land them under, for example, `assets/audio/`.

- Sound effects: produce at least a press/stamp clunk (a rock dropped from the
  scrap-press), a fire cue per component family (a sharp zap for the Capacitor /
  Emitter, a crackling chain for the Coil, and a discharge boom for the Arc-Node /
  Discharge Rig), a combine chime (the ladder climbing), a kill / ground-out pop (a
  unit destroyed), a leak alarm when a unit grounds out at the Collector and Grid
  Integrity drops, a slow hum (an icy / EM shimmer when a Choke or slow combo slows a
  unit), a burn sizzle (a crackling sizzle while a Rectifier or burn combo's
  damage-over-time ticks), and a rock-settle thunk (unkept rocks hardening into
  blockers at wave start), with `sfx-synth` and/or `sfx-sample`. The combine chime
  doubles as the combination-tower spawn cue: a recipe assembling into a combo reuses
  it, no separate sound needed. `sfx-synth` builds a sound from synth voices alone;
  `sfx-sample` layers over the baked sample pack (browse it via its `--help`) for a
  richer result; use whichever suits each cue.
- Music: produce a tense, driving industrial-electro reactor bed with `music`, a low,
  atmospheric loop under the board. `music` emits both a `.wav` (the ready asset you
  play) and a `.mid` score alongside it; play the `.wav` (the `.mid` is a portable
  companion you may keep but need not use for playback).
- Wiring. Load each `.wav` page-relative (import it / resolve its URL as above), decode
  it with the Web Audio API (`decodeAudioData`), and play it on the matching event: the
  fire cue when a component fires, the chain on a Coil's chained shot, the discharge
  boom on an Arc-Node / Discharge Rig, the stamp clunk on a press pull, the combine
  chime on a combine, the pop on a kill, the rock-settle thunk when unkept rocks harden
  into blockers at wave start, and the alarm on a leak (`specs/flow.md`), and loop the
  music bed. Do not autostart audio before the player interacts (browsers block
  autoplay), and provide a mute toggle (`specs/controls.md`, `specs/flow.md`).

## What you draw in code (no tool for these)

There is no `ui` or `paint` tool in this image, so all HUD, build-panel, and menu
chrome is drawn in code (canvas/DOM), in the palette from `specs/overview.md`:

- The entire status bar and build panel: Charge, Grid Integrity, the wave indicator
  and the untimed-build read, the scrap-press control (STAMP, its free placement, and
  the remaining stamps of the 5-per-level allowance), the UPGRADE QUALITY control (the
  Refinement level and next cost), the selected candidate/component inspector (type,
  quality tier, live stats, and the KEEP / COMBINE / targeting controls), the next-wave
  preview, and the wave/speed/mute controls (`specs/board.md`, `specs/flow.md`,
  `specs/build.md`). Their small icons may be produced `draw` sprites, but the panels,
  bars, text, and layout are code.
- All menus, overlays, and state screens: title, map select (with each map's preview),
  difficulty select, how-to-play, in-place pause and the Esc pause menu, victory, and
  overload (`specs/flow.md`, `specs/modes.md`).
- Board and selection feedback: the map-select previews, the faint tile grid over the
  yard substrate, the held-stamp ghost snapped to the 2×2 grid and its legal / illegal
  (never-seal) placement cue, the held-component and selected-component range rings,
  each unit's health bar, the quality-tier read on each component, and the live
  waypoint markers and flow direction (`specs/board.md`, `specs/controls.md`). The code
  reads the simulation and draws these cues.
- Laying out the yard per map: placing the produced yard substrate, waypoint pylons,
  Entry, Collector, and (on Map C) the transformer housings for each map's topology
  (`specs/board.md`); the sprites are produced, deciding where they go per map is code.

## Genuinely produce the assets — this is the point here

The assets must be genuinely produced with these tools. A build that ships placeholder
rectangles, ad-hoc canvas drawing in place of a produced sprite, a flat flash in place
of the produced electrical particle systems, downloaded or bundled art, or silence in
place of produced audio has not done the task, no matter how good the simulation is;
the produced assets, and above all the electrical effects, are half of what this build
is about (`specs/overview.md`, the Visuals scoring domain). Produce real pixel-art
sprites across the five quality tiers, real animated cycles, real simulated
electrical bursts, and real sound and music with the six tools, and wire those
produced files into the game. Everything the game shows and plays should trace back
either to a file you produced with a tool here, or to HUD/menu chrome you drew in code
as listed above.

# Valence — Assets you produce (the production contract)

Valence ships with no pre-made art, effects, or sound. Instead, the run image
puts six asset-generation tools on your `PATH` to help you make them, and you
must produce every asset the game plays (with those tools or any other way you
prefer) and commit the produced files, then wire them into the game. Produce
them as a one-time step: your build (`npm run build`) must be self-contained,
bundling the committed files without invoking the tools, which are on your
`PATH` only while this run is live, not when the build is re-run from the
published source. This is the defining requirement of the case: you are the
artist, the VFX author, and the sound designer as well as the engineer. This
file is the contract for what to produce, which tool makes it, where it lands,
and how it is wired in. Read it as carefully as the simulation specs.

Every measurement and color here is consistent with `specs/overview.md` (the
palette and coordinate system) and the system specs; when this file gives a
value it matches them.

## The six tools

Exactly these six binaries are on your `PATH`, no others (there is no `ui`,
`paint`, `texture`, voxel, or mesh tool in this image), so all HUD, build-panel,
and menu chrome is drawn in code (below):

| Tool          | Produces                                                | Used for                                                        |
| ------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `draw`        | one sprite → a PNG                                      | the path tracks, inlet/collector, towers, matter, and HUD icons |
| `draw-sheet`  | a sprite sheet, one PNG per frame                       | the orbiting-electron, tower-fire, and boss animations          |
| `particle-2d` | a particle system → a `system.json`                     | the decomposition bursts and muzzle effects                     |
| `sfx-synth`   | a procedural sound → a `.wav`                           | shot / strip / snap / alarm cues from raw synthesis             |
| `sfx-sample`  | a sampled sound over a baked pack → a `.wav`            | richer strip / nuclear / neutralize / build cues                |
| `music`       | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the reactor music bed                                           |

Each is a command-line tool. Run `<tool> --help` to learn its operations (and
`<tool> <operation> --help` for one operation's flags); the operation vocabulary
is the tool's own help, not restated here. In outline, each tool records the
operations you run into a log and then renders or emits the finished file: you
initialize it, issue the drawing / authoring operations, and render/emit the
output, writing the finished file into your project under `assets/`. Consult
each tool's `--help` for the exact initialize / operate / render commands and
how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing
  operations (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …).
  `draw-sheet` is `draw` plus a `--frame <index>` on every operation, emitting
  one separate PNG per frame (frames are separate files, never regions of one
  image).
- `particle-2d` authors a system (emitters, forces, and per-particle curves)
  that is simulated live; its `render`/emit step writes the `system.json` that
  is the asset. You do not place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or
  sequenced notes and render a PCM `.wav`; `music` also emits a portable `.mid`
  score alongside its `.wav`. `sfx-sample` and `music` draw on a baked sample
  pack / instrument bank already in the image (browse it via the tool's help); a
  synth from `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule
the build itself does. The built site is not guaranteed to be served from the
root of its origin; when it is played back it is mounted under a per-run
sub-path (a path like `/runs/<id>/build/`). So:

- Never reference an asset by a root-absolute URL (a leading `/`, such as
  `/assets/atom.png`). It ignores the page's location, resolves against the
  origin root, and 404s under a sub-path.
- Reference assets relative to the document or module instead. Prefer letting
  your bundler resolve them: import each PNG / `.wav` / JSON, or use a bundler
  directory glob (for example Vite's
  `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`) and
  use the URLs it returns. A runtime `new URL('./assets/…', import.meta.url)`
  also works if your bundler can statically resolve it.
- Configure your bundler's base to be relative (for Vite, `base: './'`) so the
  emitted JS, CSS, and asset URLs are all page-relative.

This governs the produced art, the `system.json` files, the `.wav`s, and the
bundled JS/CSS alike. The quickest self-check: serve your `dist/` from a
non-root sub-path and confirm the game loads with no 404s.

## Sprites — `draw` (board, towers, matter, icons)

Produce a single PNG per sprite with `draw`, on a small transparent
(straight-alpha) canvas. These are pixel art: draw at the sprite's native size
and sample it with nearest-neighbor in the game (`imageSmoothingEnabled = false`
for Canvas, `image-rendering: pixelated` for DOM) so it stays crisp. Land them
under `assets/` in a sensible layout (for example `assets/board/`,
`assets/towers/`, `assets/matter/`, `assets/icons/`). Sizes below are guidance:
a `32×32` sprite suits a tower or a unit, HUD icons may be `16×16` or `24×24`.

Produce at least these, in the palette from `specs/overview.md`:

- Board, the path/track segment art (so a path reads as a glowing conduit with a
  sense of flow, whether it sweeps as a curve or runs straight with right-angle
  corners, `specs/board.md`), the inlet, and the collector. A tiling track
  sprite or a small set of segment/corner pieces is fine; the goal is that a
  path and its direction read at a glance on every map. There is no build-cell
  marker (placement is free, and the legal/illegal placement cue is drawn in
  code, below).
- Towers, each of the seven towers (Emitter, Ionizer, Cleaver, Reactor, Beam,
  Catalyst, Moderator, `specs/towers.md`), color-coded by role, and each with a
  visible change across its tiers (tier II stronger and tier III carrying a mark
  of its chosen branch, either a distinct sprite per tier or a base sprite plus
  a produced tier/branch accent/overlay). A tower must read as its type, as
  upgraded, and (at tier III) as which branch it took. Author the five damage
  towers (Emitter, Ionizer, Cleaver, Reactor, Beam) as a rotatable head/turret:
  draw the head pointing in a single canonical direction (for example toward
  `+x`, "east") so the game can rotate the whole head to aim it at the target
  (`specs/towers.md`), and, because a spinning head reads better on a fixed
  mount, produce a separate non-rotatable base/mount sprite to sit under it (the
  head rotates; the base does not). Keep the head's canonical facing consistent
  across a tower's tiers. The two support towers are auras and need not rotate.
- Projectiles, a small shot sprite per damage type (an energy bolt, a kinetic
  shard, a nuclear slug), colored to its type (`specs/overview.md`) and drawn
  pointing in the same canonical direction as the heads, so the game rotates
  each to its heading as it flies. The projectile is the object that carries the
  hit (`specs/towers.md`), so it must be a visible traveling sprite, not a
  static dot at the muzzle, and not omitted in favour of an instant hitscan.
- Matter, the pieces the traits are built from (`specs/matter.md`): the nucleus
  orb (in the element tints; the electron shells may be drawn in code as rings
  over the produced orb, or produced as part of a `draw-sheet` cycle below), the
  bond stick used to compose bonded clusters from atom sprites, the inert/noble
  sealed atom (with a shrouded look that reads as camouflaged), the heavy
  nucleus (dense, with its radioactive look), and the boss core. Because traits
  stack, the game composites reads over the produced orbs (a bond-integrity arc,
  a heavy's hit-point arc, a reveal ring), so a cloaked heavy or a cloaked
  cluster reads correctly. Clusters are composed in code from the atom and bond
  sprites; you need not pre-draw every cluster.
- HUD icons, the small marks the status bar and build panel use
  (`specs/board.md`, `specs/campaign.md`): energy, integrity, and a glyph for
  each of the seven towers and, optionally, for each matter type in the
  next-round preview. These sit inside the in-code HUD.

## Animations — `draw-sheet` (electrons, tower fire, the boss)

Produce with `draw-sheet`, which emits one PNG per frame. The matter must feel
alive, not a static dot. Produce at least these cycles, each as a short sequence
of frames (land them under, for example, `assets/matter/electrons/`,
`assets/towers/<tower>/`, `assets/matter/boss/`, one PNG per frame):

- Orbiting electrons, the electrons that orbit a free atom, played so they
  visibly spin. A regular atom carries 1–6 electrons on two shells (up to `2` on
  the inner and up to `4` on the outer, `specs/matter.md`), and the count is its
  remaining hit points, so as an atom is stripped it must visibly shed an
  electron. Produce a single-electron sprite (a short pulse cycle is welcome)
  that the game composites once per electron around the two shells and orbits,
  or a nucleus-plus-electrons cycle, so any `1`–`6` electron count reads and the
  shells empty (outer first) as the atom loses hit points.
- A tower firing cycle for at least the primary damage towers (an energy charge
  pulse for the Ionizer/Emitter/Beam, the Cleaver's cleaving motion, the
  Reactor's rotor) so a firing tower animates rather than sitting inert; a
  Catalyst/Moderator shimmer is welcome.
- The boss, a short unstable-wobble/pulse cycle for the Macromass
  (`specs/matter.md`), so the boss visibly seethes as it is worn down.

In the game, play the matching cycle for what a unit or tower is doing,
advancing frames on a timer so the motion reads. It is fine to reuse a nucleus
body across element tints; the point is that atoms visibly orbit, towers visibly
fire, and the boss visibly seethes.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The decomposition events are the game's punctuation, and they are particle
systems you author with `particle-2d` and play live, not flat flashes or
hand-coded effects. `particle-2d` authors a system (emitters, forces,
per-particle size/opacity/color curves) whose `render`/emit step writes a
`system.json`; land them under, for example, `assets/fx/`. Produce at least:

- Strip spark, a sharp burst in the electron/damage color when a shot strips a
  shell (`specs/matter.md`); tinting it by the landing damage type
  (energy/kinetic/nuclear) is welcome.
- Bond-snap shards, a scatter of shards when a bonded cluster's bond pool is
  chipped and it sheds an atom.
- Split flash, a bright radioactive burst when an isotope decays: each time a
  heavy or the boss sheds an alpha/beta particle, and when it finally bursts at
  the end of its decay chain (`specs/matter.md`).
- Neutralize burst, an energy-release burst when a unit is stripped to nothing
  and neutralized (the moment its last shell is stripped).
- Reveal pulse, a brief pulse when a detector reveals an inert unit (welcome;
  the game also draws a reveal ring in code).

A tower muzzle/impact effect (a shot trail or impact flash for the damage
towers) and a small collector leak effect are welcome additions.

Play them with the provided runtime. `@test-cabinet/particle-runtime` is already
a dependency of your project (its `file:` entry is in your `package.json`;
install and import it like any other dependency, do not fetch or reimplement
it). For this 2D game use its `/canvas` binding, its `ParticleCanvasPlayer`:
construct one from a parsed `system.json` and your 2D canvas context, and
advance it each frame with your frame delta; it simulates the system and
composites the particles. The package's own types are the authoritative API;
read them for the exact constructor and update signatures. (Its pure
`ParticleSimulator` is also exported if you would rather composite the particles
yourself.)

Fire the bursts from the simulation. Spawn an instance of the matching system at
the event's position (the ionization spark at the atom that lost a shell, the
bond-snap at the broken bond, the split flash at a decaying isotope, the
neutralize burst at the atom as it is removed) and let it play out. Because
these are simulated, they vary shot to shot; that variation is correct, do not
freeze them into a single canned frame.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the board's sound with the audio tools and play the resulting `.wav`s
via the Web Audio API. Land them under, for example, `assets/audio/`.

- Sound effects, produce at least: a tower shot / shell strip cue, a bond snap,
  a nuclear crack (a heavy or boss decaying), a neutralize chime (a unit fully
  broken down), a build/place cue, and a leak alarm when a unit reaches the
  collector, with `sfx-synth` and/or `sfx-sample` (a reveal blip is a welcome
  extra). `sfx-synth` builds a sound from synth voices alone; `sfx-sample`
  layers over the baked sample pack (browse it via its `--help`) for a richer
  result; use whichever suits each cue.
- Music, produce a tense reactor music bed with `music`: a driving, low,
  atmospheric loop under the board. `music` emits both a `.wav` (the ready asset
  you play) and a `.mid` score alongside it; play the `.wav` (the `.mid` is a
  portable companion you may keep but need not use for playback).
- Wiring. Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the
  matching event (the shot cue when a damage tower fires, the snap on a chipped
  bond, the crack when a heavy or boss splits, the chime on a neutralize, the
  build cue on a placed tower, and the alarm on a leak, `specs/campaign.md`),
  and loop the music bed. Do not autostart audio before the player interacts
  (browsers block autoplay), and provide a mute toggle (`specs/controls.md`,
  `specs/campaign.md`).

## What you draw in code (no tool for these)

There is no `ui` or `paint` tool in this image, so all HUD, build-panel, and
menu chrome is drawn in code (canvas/DOM), in the palette from
`specs/overview.md`:

- The entire status bar and build panel: energy, integrity, the round indicator,
  the shop, the selected-tower inspector, the next-round preview, and the
  round/speed/mute controls (`specs/board.md`, `specs/campaign.md`). Their small
  icons may be produced `draw` sprites, but the panels, bars, text, and layout
  are code.
- All menus, overlays, and state screens: title, how-to-play, pause, victory,
  and containment-failed (`specs/campaign.md`).
- Board and selection feedback: the map-select previews, the held-tower ghost
  and its legal/illegal placement cue, the held-tower and selected-tower range
  rings, and each unit's integrity read (a free atom's shell rings drawn over
  the produced orb, a bonded cluster's draining bond arc, a heavy's draining
  hit-point arc, and the reveal/cloak mark on inert matter and the
  excite/slow/mark status rings; the composited electron overlay may be a
  produced `draw-sheet` cycle). The code that reads the simulation and draws
  these cues is yours (`specs/board.md`, `specs/matter.md`,
  `specs/controls.md`).
- The path routing: laying the produced track sprites along each map's paths
  (curved or straight/right-angle) and drawing the flow direction; the
  tiles/segments are produced, deciding where they go per map is code.

## Genuinely produce the assets — this is the point here

The assets must be genuinely produced with these tools. A build that ships
placeholder rectangles, ad-hoc canvas drawing in place of a produced sprite, a
flat flash in place of the produced particle bursts, downloaded or bundled art,
or silence in place of produced audio has not done the task, no matter how good
the simulation is; the produced assets are half of what this build is about
(`specs/overview.md`, the Presentation & Assets domain). Produce real pixel-art
sprites, real animated cycles, real simulated particle bursts, and real sound
and music with the six tools, and wire those produced files into the game.
Everything the game shows and plays should trace back either to a file you
produced with a tool here, or to HUD/menu chrome you drew in code as listed
above.

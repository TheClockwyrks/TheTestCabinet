# Valence — Assets you produce (the production contract)

Valence ships with **no** pre-made art, effects, or sound. Instead, the run image puts six
**asset-generation tools** on your `PATH` to help you make them, and **you must produce
every asset the game plays — with those tools or any other way you prefer — and commit the
produced files**, then wire them into the game. Produce them as a one-time step: your build
(`npm run build`) must be **self-contained**, bundling the committed files without invoking
the tools, which are on your `PATH` only while this run is live — not when the build is
re-run to validate it or rebuilt from the published source. This is the defining
requirement of the case: you are the artist, the VFX author, and the sound designer as well
as the engineer. This file is the contract — what to produce, which tool makes it, where it
lands, and how it is wired in. **Read it as carefully as the simulation specs.**

Every measurement and color here is consistent with `specs/overview.md` (the palette and
coordinate system) and the system specs; when this file gives a value it matches them.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image), so all HUD, build-panel, and menu chrome is
drawn **in code** (below):

| Tool | Produces | Used for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | the tracks, nodes, inlet/collector, towers, matter, and HUD icons |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the orbiting-electron, tower-fire, and boss animations |
| `particle-2d` | a particle system → a `system.json` | the decomposition bursts and muzzle effects |
| `sfx-synth` | a procedural sound → a `.wav` | shot / strip / snap / alarm cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer strip / fission / neutralize / build cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the reactor music bed |

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is the
tool's own help, not restated here. In outline, each tool **records the operations you run
into a log and then renders or emits the finished file**: you initialize it, issue the
drawing / authoring operations, and render/emit the output, writing the finished file into
your project under **`assets/`**. Consult each tool's `--help` for the exact initialize /
operate / render commands and how to name the output path.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `mirror-horizontal`, …). `draw-sheet` is `draw` plus
  a `--frame <index>` on every operation, emitting **one separate PNG per frame** (frames
  are separate files, never regions of one image).
- `particle-2d` authors a **system** — emitters, forces, and per-particle curves — that is
  **simulated live**; its `render`/emit step writes the `system.json` that is the asset. You
  do **not** place individual particles or bake frames.
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or sequenced
  notes and render a PCM `.wav`; `music` also emits a portable `.mid` score alongside its
  `.wav`. `sfx-sample` and `music` draw on a **baked sample pack / instrument bank** already
  in the image (browse it via the tool's help); a synth from `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the build
itself does. The built site is **not guaranteed to be served from the root of its
origin** — when it is played back it is mounted under a **per-run sub-path** (a path like
`/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/atom.png`). It ignores the page's location, resolves against the origin root, and
  404s under a sub-path.
- **Reference assets relative to the document or module instead.** Prefer letting your
  bundler resolve them: import each PNG / `.wav` / JSON, or use a bundler directory glob (for
  example Vite's `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`)
  and use the URLs it returns. A runtime `new URL('./assets/…', import.meta.url)` also works
  if your bundler can statically resolve it.
- **Configure your bundler's base to be relative** (for Vite, `base: './'`) so the emitted
  JS, CSS, and asset URLs are all page-relative.

This governs the produced art, the `system.json` files, the `.wav`s, and the bundled JS/CSS
alike. The quickest self-check: serve your `dist/` from a non-root sub-path and confirm the
game loads with no 404s.

## Sprites — `draw` (board, towers, matter, icons)

Produce a **single PNG per sprite** with `draw`, on a small transparent (straight-alpha)
canvas. These are **pixel art**: draw at the sprite's native size and sample it with
**nearest-neighbor** in the game (`imageSmoothingEnabled = false` for Canvas,
`image-rendering: pixelated` for DOM) so it stays crisp. Land them under `assets/` in a
sensible layout (for example `assets/board/`, `assets/towers/`, `assets/matter/`,
`assets/icons/`). Sizes below are guidance — a `32×32` sprite suits a tower or a unit, HUD
icons may be `16×16` or `24×24`.

Produce at least these, in the palette from `specs/overview.md`:

- **Board** — the **conduit/track** segment art (so the channel reads as a glowing conduit
  with a sense of flow), the **empty node** marker, the **inlet**, and the **collector**
  (`specs/board.md`). A tiling conduit sprite or a small set of segment/corner pieces is
  fine; the goal is that the conduit and its direction read at a glance.
- **Towers** — each of the five towers (Ionizer, Shear, Fission, Catalyst, Moderator,
  `specs/towers.md`), **color-coded** by role, and each with a **visible change across its
  three upgrade levels** (a distinct sprite per level, or a base sprite plus a produced tier
  accent/overlay). A tower must read as its type and as upgraded when it is. **Author the
  three damage towers (Ionizer, Shear, Fission) as a rotatable head/turret**: draw the head
  pointing in a **single canonical direction** (for example toward `+x`, "east") so the game
  can **rotate the whole head to aim it at the target** (`specs/towers.md`), and — because a
  spinning head reads better on a fixed mount — produce a separate **non-rotatable
  base/mount** sprite to sit under it (the head rotates; the base does not). Keep the head's
  canonical facing consistent across a tower's three levels. The two support towers are
  auras and need not rotate.
- **Projectiles** — a small **shot sprite for each damage tower** (the Ionizer's charge
  bolt, the Shear's cleaving shard, the Fission's slug), color-coded to its tower and drawn
  pointing in the **same canonical direction** as the heads, so the game rotates each to its
  heading as it flies. The projectile is the object that carries the hit
  (`specs/towers.md`), so it must be a **visible travelling sprite** — not a static dot at
  the muzzle, and not omitted in favour of an instant hitscan.
- **Matter** — the forms (`specs/matter.md`): the **nucleus orb** (in the element tints;
  the electron shells may be drawn in code as rings *over* the produced orb, or produced as
  part of a `draw-sheet` cycle below), the **bond stick** used to compose molecules from
  atom sprites, the **inert/noble** sealed atom, the **heavy nucleus** (dense, with its
  radioactive look), and the **boss** core. Molecules are composed **in code** from the atom
  and bond sprites (place `k` atoms joined by `k − 1` bonds); you need not pre-draw every
  molecule.
- **HUD icons** — the small marks the status bar and build panel use (`specs/board.md`,
  `specs/flow.md`): **energy**, **integrity**, and a glyph for each of the five towers and,
  optionally, for each matter type in the next-round preview. These sit inside the in-code
  HUD.

## Animations — `draw-sheet` (electrons, tower fire, the boss)

Produce with `draw-sheet`, which emits **one PNG per frame**. The matter must feel **alive**,
not a static dot. Produce at least these cycles, each as a short sequence of frames (land
them under, for example, `assets/matter/electrons/`, `assets/towers/<tower>/`,
`assets/matter/boss/`, one PNG per frame):

- **Orbiting electrons** — a short looping cycle of the electron shells orbiting a nucleus,
  played on free atoms so they visibly spin (you may produce it as a nucleus-plus-electrons
  cycle, or as an electrons-only overlay you composite over the produced nucleus orb). The
  number of shells shown should track the atom's remaining shells (`specs/matter.md`) —
  produce enough of the cycle, or enough shell variants, that an atom losing a shell reads.
- **A tower firing cycle** for at least the primary damage towers (the Ionizer's charge
  pulse, the Shear's cleaving motion, the Fission's rotor) so a firing tower animates rather
  than sitting inert; a Catalyst/Moderator shimmer is welcome.
- **The boss** — a short **unstable-wobble/pulse** cycle for the Macromass
  (`specs/matter.md`), so the boss visibly seethes as it is fissioned.

In the game, **play the matching cycle** for what a unit or tower is doing, advancing frames
on a timer so the motion reads. It is fine to reuse a nucleus body across element tints; the
point is that atoms visibly orbit, towers visibly fire, and the boss visibly seethes.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The **decomposition events** are the game's punctuation, and they are **particle systems**
you author with `particle-2d` and **play live** — not flat flashes or hand-coded effects.
`particle-2d` authors a system (emitters, forces, per-particle size/opacity/color curves)
whose `render`/emit step writes a **`system.json`**; land them under, for example,
`assets/fx/`. Produce at least:

- **Ionization spark** — a sharp burst in the electron color when an Ionizer strips a shell
  (`specs/matter.md`).
- **Bond-snap shards** — a scatter of shards when a Shear breaks a bond and peels an atom
  off a molecule.
- **Fission flash** — a bright radioactive burst when a heavy (or a boss step) splits into
  daughter atoms.
- **Neutralize burst** — an energy-release burst when an atom is stripped to nothing and
  neutralized (the moment it pays its bounty).

A **tower muzzle/impact** effect (a shot trail or impact flash for the damage towers)
and a small **collector leak** effect are welcome additions.

**Play them with the provided runtime.** `@test-cabinet/particle-runtime` is already a
dependency of your project (its `file:` entry is in your `package.json`; install and import
it like any other dependency — do **not** fetch or reimplement it). For this 2D game use its
**`/canvas`** binding — its `ParticleCanvasPlayer`: construct one from a parsed `system.json`
and your 2D canvas context, and advance it each frame with your
frame delta; it simulates the system and composites the particles. The package's own
types are the authoritative API — read them for the exact constructor and update
signatures. (Its pure `ParticleSimulator` is also
exported if you would rather composite the particles yourself.)

**Fire the bursts from the simulation.** Spawn an instance of the matching system **at the
event's position** — the ionization spark at the atom that lost a shell, the bond-snap
at the broken bond, the fission flash at the splitting heavy, the neutralize burst at
the atom as it is removed — and let it play out. Because these are simulated, they vary
shot to shot — that variation is correct; do not freeze them into a single canned frame.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Produce the board's sound with the audio tools and play the resulting `.wav`s via the Web
Audio API. Land them under, for example, `assets/audio/`.

- **Sound effects** — produce at least: a **tower shot / electron strip** cue, a **bond
  snap**, a **fission crack**, a **neutralize** chime (an atom fully broken down), a
  **build/place** cue, and a **leak alarm** when a unit reaches the collector, with
  `sfx-synth` and/or `sfx-sample`. `sfx-synth` builds a sound from synth voices alone;
  `sfx-sample` layers over the baked sample pack (browse it via its `--help`) for a richer
  result — use whichever suits each cue.
- **Music** — produce a **tense reactor music bed** with `music`: a driving, low,
  atmospheric loop under the board. `music` emits both a `.wav` (the ready asset you play)
  and a `.mid` score alongside it; **play the `.wav`** (the `.mid` is a portable companion
  you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching
  event — the shot cue when a damage tower fires, the snap on a broken bond, the crack
  on a fission, the chime
  on a neutralize, the build cue on a placed tower, and the alarm on a leak (`specs/flow.md`)
  — and loop the music bed. **Do not autostart audio before the player interacts** (browsers
  block autoplay), and provide a **mute** toggle (`specs/controls.md`, `specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, so **all HUD, build-panel, and menu
chrome is drawn in code** (canvas/DOM), in the palette from `specs/overview.md`:

- The entire **status bar** and **build panel** — energy, integrity, the round indicator,
  the shop, the selected-tower inspector, the next-round preview, and the round/speed/mute
  controls (`specs/board.md`, `specs/flow.md`). Their small **icons** may be produced `draw`
  sprites, but the panels, bars, text, and layout are code.
- All **menus, overlays, and state screens** — title, how-to-play, pause, victory, and
  containment-failed (`specs/flow.md`).
- **Board and selection feedback** — the node highlights, the held-tower and selected-tower
  **range rings**, the build-legality cues, and each unit's **integrity read** (an atom's
  shell rings drawn over the produced orb, a molecule's bond count, a heavy's criticality;
  the composited electron overlay may be a produced `draw-sheet` cycle) — the code that reads
  the simulation and draws these cues (`specs/board.md`, `specs/matter.md`, `specs/controls.md`).
- The **conduit routing** — laying the produced conduit sprites along the fixed track and
  drawing the flow direction; the *tiles/segments* are produced, deciding where they go is
  code.

## Genuinely produce the assets — this is the point here

The assets must be **genuinely produced with these tools**. A build that ships **placeholder
rectangles**, **ad-hoc canvas drawing in place of a produced sprite**, a **flat flash in place
of the produced particle bursts**, **downloaded or bundled art**, or **silence in place of
produced audio** has not done the task, no matter how good the simulation is — the produced
assets are half of what this build is about (`specs/overview.md`, the Presentation & Assets
domain). Produce real pixel-art sprites, real animated cycles, real simulated particle bursts,
and real sound and music with the six tools, and wire those produced files into the game.
Everything the game shows and plays should trace back either to a file you produced with a
tool here, or to HUD/menu chrome you drew in code as listed above.

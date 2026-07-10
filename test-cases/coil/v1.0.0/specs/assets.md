# Coil — Assets you produce (the production contract)

Coil ships with **no** pre-made art or sound. Instead, the run image puts six
**asset-generation tools** on your `PATH`, and **you must produce the snake's sprite
set and the game's audio with those tools — or any other way you prefer — and commit
the produced files**, then wire them into the game. Everything else the game draws (the
board, its walls, the maze obstacles, the pellet, and the whole HUD) stays **drawn in
code**, as it always was; only the snake and the sound become produced assets in this
version.

Produce the assets as a **one-time step**: your build (`npm run build`) must be
**self-contained**, bundling the committed files without invoking the tools, which are
on your `PATH` only while this run is live — **not** when the build is re-run to
validate it or rebuilt from the published source. A build that shells out to `draw` (or
any of the tools) at build time fails wherever they are absent, even though the game is
complete. This is a defining requirement of the case: you are the sprite artist and the
sound designer as well as the engineer. **Read this file as carefully as the mechanics
spec.**

Every measurement and color here is consistent with `specs/overview.md` (the palette
and coordinate system) and `specs/playfield.md` (the 32×32 cell grid); when this file
gives a value it matches them.

## The six tools

Exactly these six binaries are on your `PATH` — no others (there is no `ui`, `paint`,
`texture`, voxel, or mesh tool in this image):

| Tool | Produces | Used in Coil for |
| --- | --- | --- |
| `draw` | one sprite → a PNG | the straight-body, corner, and tail snake sprites |
| `draw-sheet` | a sprite sheet, **one PNG per frame** | the animated snake head with its bite |
| `sfx-synth` | a procedural sound → a `.wav` | the eat / combo-up / death cues from raw synthesis |
| `sfx-sample` | a sampled sound over a baked pack → a `.wav` | richer eat / combo-up / death cues |
| `music` | sequenced music over a baked bank → a `.wav` (+ `.mid`) | the background music bed |
| `particle-2d` | a particle system → a `system.json` | **not required** — available for optional flourishes only |

Coil needs the sprite tools (`draw`, `draw-sheet`) and the audio tools (`sfx-synth`,
`sfx-sample`, `music`). `particle-2d` is present but **nothing in this case requires
it**; you may ignore it. Do not add pre-made art, downloaded sound, or a bundled font in
place of producing these assets.

Each is a command-line tool. **Run `<tool> --help` to learn its operations** (and
`<tool> <operation> --help` for one operation's flags) — the operation vocabulary is the
tool's own help, not restated here. In outline, each tool **records the operations you
run into a log and then renders or emits the finished file**: you initialize it, issue
the drawing / authoring operations, and render/emit the output, writing the finished
file into your project under **`assets/`**.

- `draw` / `draw-sheet` rasterize a fixed-size RGBA canvas from drawing operations
  (`fill-rect`, `line`, `fill-circle`, `stroke-rect`, `flood-fill`,
  `mirror-horizontal`, …). `draw-sheet` is `draw` plus a `--frame <index>` on every
  operation, emitting **one separate PNG per frame** (frames are separate files, never
  regions of one image).
- `sfx-synth` / `sfx-sample` / `music` record synth voices, sampled layers, or sequenced
  notes and `render` a PCM `.wav`; `music` also emits a portable `.mid` score alongside
  its `.wav`. `sfx-sample` and `music` draw on a **baked sample pack / instrument bank**
  already in the image (browse it via `list-samples` / the tool's help); a synth from
  `sfx-synth` needs no pack.

## Loading rule — page-relative, so it works under any base path

Every produced file is loaded at runtime, so it obeys the same base-path rule the build
itself does. The built site is **not guaranteed to be served from the root of its
origin** — it is played back mounted under a **per-run sub-path** (a path like
`/runs/<id>/build/`). So:

- **Never reference an asset by a root-absolute URL** (a leading `/`, such as
  `/assets/head.png`). It resolves against the origin root and 404s under a sub-path.
- **Reference assets relative to the document or module instead.** Prefer letting your
  bundler resolve them: import each PNG / `.wav`, or use a bundler directory glob (for
  example Vite's `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`)
  and use the URLs it returns. A runtime `new URL('./assets/…', import.meta.url)` also
  works if your bundler can statically resolve it.
- **Configure your bundler's base to be relative** (for Vite, `base: './'`) so the
  emitted JS, CSS, and asset URLs are all page-relative.

The quickest self-check: serve your `dist/` from a non-root sub-path and confirm the
game loads with no 404s.

## The snake sprite set — `draw` and `draw-sheet`

The snake is no longer drawn as code rectangles: **render it from a produced sprite
set**, pixel art on a **32×32** transparent (straight-alpha) canvas per cell, matching
the cell size in `specs/playfield.md`. These are pixel art — draw at native size and
sample them **nearest-neighbor** in the game (`imageSmoothingEnabled = false` for Canvas,
`image-rendering: pixelated` for DOM) so they stay crisp (`specs/overview.md`). Use the
snake head/body palette from `specs/overview.md` (head `#5ef38c`, body `#2fd07a`), with
the neon glow either baked into the sprite or added in code. Land them under `assets/snake/`.

You author each sprite in **one canonical orientation** and **rotate/flip it in code** to
cover the snake's four travel directions and its turns — you do not produce a separate
PNG for every direction. Produce this set:

- **An animated head with a bite — `draw-sheet`.** A short sheet (**one PNG per frame**,
  under e.g. `assets/snake/head/`) of the head authored facing **one** direction (for
  example `+col`, i.e. right). It has a **resting** pose (mouth closed) and a **bite**:
  a couple of frames where the mouth opens and chomps shut. In the game, show the resting
  head normally and **play the bite when the snake eats a pellet** (trigger it on the eat
  tick in `specs/mechanics.md`), advancing the frames on a timer, then return to rest.
  Rotate the head sprite to the snake's current facing.
- **A straight-body segment — `draw`.** A single sprite for a body cell whose entry and
  exit are opposite (the snake going straight through it), authored **horizontal**; rotate
  it 90° for vertical runs. It must read as clearly dimmer than the head.
- **A corner/turn segment — `draw`.** A single sprite for a body cell where the snake
  **bends** 90° (entry and exit perpendicular), authored for **one** of the four corner
  orientations; rotate/flip it to the other three. This is what makes a turning snake read
  as a continuous coil rather than a staircase of squares — **use it at every bend**, not
  just for straight runs.
- **A tail segment — `draw`** *(recommended)*. A sprite for the final cell that tapers to
  a point, authored facing one direction and rotated to the tail's outgoing direction. If
  you skip it, reuse the straight-body sprite for the tail; a distinct tail reads better.

Pick the right sprite per body cell from the snake's geometry: for each segment, look at
its neighbor toward the head and its neighbor toward the tail — opposite neighbors →
straight sprite (rotated to the run's axis); perpendicular neighbors → corner sprite
(rotated/flipped to that bend); the head cell → the head sheet (rotated to facing); the
last cell → the tail sprite. The result is one continuous snake built entirely from the
produced sprites.

## Audio — `sfx-synth` / `sfx-sample` and `music`, played via Web Audio

Coil's audio is now **required and produced** (this supersedes the earlier "optional,
synthesize it inline" note — see `specs/flow.md`). Produce the sound with the audio tools
and play the resulting `.wav`s via the Web Audio API. Land them under `assets/audio/`.

- **Sound effects** — produce at least an **eat** cue (a short blip when a pellet is
  eaten), a **combo-up** cue (a brighter blip when the combo multiplier increases), and a
  **death** sound (a distinct tone when the snake dies) with `sfx-synth` and/or
  `sfx-sample`. `sfx-synth` builds a sound from synth voices alone; `sfx-sample` layers
  over the baked sample pack (browse it via `list-samples`) for a richer result — use
  whichever suits each cue. A short chime for any mode bonus is optional.
- **Music** — produce a **low-key background music bed** with `music`: an unobtrusive
  loop that sits under the game. `music` emits both a `.wav` (the ready asset you play)
  and a `.mid` score alongside it; **play the `.wav`** (the `.mid` is a portable companion
  you may keep but need not use for playback).
- **Wiring.** Load each `.wav` page-relative (import it / resolve its URL as above),
  decode it with the Web Audio API (`decodeAudioData`), and play it on the matching event
  — the eat cue on the eat tick, the combo-up cue when `M` rises, the death sound on a
  fatal collision (`specs/mechanics.md`, `specs/flow.md`) — and loop the music bed. **Do
  not autostart audio before the player interacts** (browsers block autoplay), and provide
  a **mute** toggle (`specs/flow.md`).

## What you draw in code (no tool for these)

There is **no** `ui` or `paint` tool in this image, and this case deliberately keeps most
of the board code-drawn. In the palette from `specs/overview.md`, draw in code
(canvas/DOM):

- The **board** — the interior field, its faint per-cell grid, and the **wall border**
  (`specs/playfield.md`).
- The **maze obstacles** — the fixed interior obstacle bars the Maze mode places
  (`specs/modes/maze.md`), drawn in the obstacle color.
- The **pellet** — the single food dot, drawn in the pellet color with its glow
  (`specs/playfield.md`). (Producing a pellet sprite is not required; keep it code-drawn.)
- The entire **HUD** — score, best, the combo readout and its draining window bar, and the
  mode label (`specs/flow.md`).
- All **menus, overlays, panels, and state screens** — title, how-to-play, pause, game
  over / board cleared (`specs/flow.md`), and the mute toggle.

## Genuinely produce the assets — this is the point of the case

The snake sprites and the audio must be **genuinely produced with these tools**. A build
that renders the snake as **code-drawn rounded rectangles**, ships a **single static head
with no bite**, renders turns as **un-cornered squares**, or plays **silence or a
hand-oscillated Web Audio stand-in** in place of produced sound has not done the task, no
matter how correct the game logic is — the produced assets are half of what this case
scores (`specs/overview.md`, the Presentation & Assets domain). Produce a real pixel-art
snake set (an animated biting head, a straight body, corner sprites, and ideally a tail),
real produced sound effects, and a real produced music bed, and wire those committed files
into the game.

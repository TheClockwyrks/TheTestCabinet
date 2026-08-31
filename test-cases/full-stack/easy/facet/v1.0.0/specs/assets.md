# Facet — Assets you produce (the production contract)

Facet ships with no pre-made art, effects, or sound. The current environment
puts six asset-generation tools on your `PATH`, and you produce every gem, every
effect, and every sound the game plays with those tools, commit the produced
files, and wire them into the game. This file is the contract: what to produce,
which tool makes it, where it lands, and how it is played.

Produce the assets as a one-time step. Your build (`npm run build`) is
self-contained: it bundles the committed files without invoking the tools, which
are on your `PATH` only while this run is live, and not when the build is re-run
to validate it or rebuilt from the published source. A build that shells out to
`draw` or any of the other five at build time fails wherever they are absent,
however complete the game is.

Every figure here is consistent with `specs/board.md`, which fixes the cell
geometry the produced art is drawn to, and `specs/rules.md`, which fixes the
kinds, the cuts, and the strain states the art covers.

## The six tools

Exactly these six binaries are on your `PATH`, and no others (there is no `ui`,
`paint`, `texture`, voxel, or mesh tool in the current environment):

| Tool | Produces | Used in Facet for |
| --- | --- | --- |
| `draw` | one sprite to a PNG | the seven kinds at each of four strain states, the three cut treatments, the board frame |
| `draw-sheet` | a sprite sheet, one PNG per frame | each kind's break animation, and the prism's idle turn |
| `particle-2d` | a particle system to a `system.json` | the clear burst, the flawed detonation, the cut-gem flash, the cut aura |
| `sfx-synth` | a procedural sound to a `.wav` | select, swap, refuse, land, flaw, cut, level-up, game-over, and the chain ladder |
| `sfx-sample` | a sampled sound over a baked pack to a `.wav` | the shatter body layered under the clear cue |
| `music` | sequenced music over a baked bank to a `.wav` (+ `.mid`) | the title theme and the play bed |

Each is a command-line tool. Run `<tool> --help` to learn its operations (and
`<tool> <operation> --help` for one operation's flags); the operation vocabulary
is the tool's own help, not restated here. In outline, each tool records the
operations you run into a log and then renders or emits the finished file: you
initialize it, issue the drawing or authoring operations, and render or emit the
output, writing the finished file into your project under `public/assets/`.

- `draw` and `draw-sheet` rasterize a fixed-size RGBA canvas from drawing
  operations (`fill-rect`, `line`, `fill-circle`, `stroke-rect`, `flood-fill`,
  `mirror-horizontal`, and so on). `draw-sheet` is `draw` plus a
  `--frame <index>` on every operation, emitting one separate PNG per frame
  (frames are separate files, never regions of one image).
- `particle-2d` authors a system of emitters, forces, and per-particle curves
  that is simulated live; its render step writes the `system.json` that is the
  asset. Individual particles are not placed and frames are not baked.
- `sfx-synth`, `sfx-sample`, and `music` record synth voices, sampled layers, or
  sequenced notes and render a PCM `.wav`; `music` also emits a portable `.mid`
  score alongside its `.wav`. `sfx-sample` and `music` draw on a baked sample
  pack and instrument bank already available in the current environment (browse
  them via `list-samples` and the tool's help); a synth from `sfx-synth` needs
  no pack.

## Where produced files land, and how they load

Commit every produced file under `public/assets/` at the project root, in the
directories the sections below name. Vite copies that tree into `dist/`
unchanged, so a file committed at `public/assets/gems/ruby.png` is served at
`assets/gems/ruby.png` beside the page. Where a runtime owns asset loading, that
served `assets/` directory is its asset root, and a file is named to it by the
path below that root, as `gems/ruby.png`.

Every produced file is loaded at runtime, so it obeys the same base-path rule
the build itself does. The built site is not guaranteed to be served from the
root of its origin; it is played back mounted under a per-run sub-path, a path
like `/runs/<id>/build/`. So:

- Reference every asset page-relative, as `assets/gems/ruby.png`, which resolves
  against the document wherever the site is mounted.
- A root-absolute URL, a leading `/` as in `/assets/ruby.png`, resolves against
  the origin root and 404s under a sub-path.
- The project's Vite configuration already sets a relative base, so the emitted
  JS, CSS, and asset URLs are page-relative too.

This governs the produced art, the `system.json` files, the `.wav`s, and the
bundled JS and CSS alike. The quickest self-check: serve your `dist/` from a
non-root sub-path and confirm the game loads with no 404s.

## Sprites — `draw`

Every gem on the board is a produced sprite. Produce a single PNG per sprite
with `draw`, on a `64 x 64` transparent (straight-alpha) canvas, sized to the
`GEM_R` (`30`) gem radius the board draws at. These are pixel art: draw them at
native size and sample them nearest-neighbor in the game
(`imageSmoothingEnabled = false` for Canvas, `image-rendering: pixelated` for
DOM) so they stay crisp. Land them under `public/assets/gems/`.

- The seven kinds at each of four strain states, one sprite each. The lit,
  faceted look of a lapidary's bench is the target, and each kind is told apart
  from the other six at a glance by silhouette and cut pattern rather than by
  hue alone, so a player reading the board fast never confuses two of them. The
  four strain states read as deepening damage in order: an unmarked stone, a
  first crack, a spreading fracture, and a stone cracked through that is
  visibly about to go.
- The `brilliant` and the `star` treatments, one sprite each, drawn as overlays
  composited over a kind's sprite. Each reads at a glance as a different stone
  from the plain cut of the same kind, and the two read as different from each
  other.
- The `prism` at each of four strain states, one sprite each. A prism carries no
  kind, so it is its own stone: a clear, many-colored cut that belongs to none
  of the seven and is never mistaken for one of them.
- The board frame, one sprite. The bench surround the eight-by-eight field sits
  on, drawn so the field's extent reads without a code-drawn outline.

## Animations — `draw-sheet`

Produce the motion on the board with `draw-sheet`, which emits one PNG per
frame. Land each sequence under its own directory, for example
`public/assets/gems/break/ruby/` and `public/assets/gems/prism-turn/`.

- A break animation for each of the seven kinds, a short sequence in which the
  stone fractures and flies apart. Play a cleared gem's sheet at its cell when a
  chain step removes it, starting at the moment `specs/rules.md` gives that
  cell's wave and advancing the frames on a timer, and the cell is empty once the
  sheet has run.
- The prism's idle turn, a short looping sequence in which the cut rotates and
  catches the light. Loop it for every prism standing on the board, so a prism
  is picked out from the stones around it by its motion as well as its art.

## Particle systems — `particle-2d`, played via `@test-cabinet/particle-runtime`

The bursts a clearing board throws are particle systems you author with
`particle-2d` and play live rather than flat flashes drawn in code.
`particle-2d` authors a system of emitters, forces, and per-particle size,
opacity, and color curves whose render step writes a `system.json`; land them
under `public/assets/fx/`. Produce these four:

- The clear burst, a short one-shot thrown at each cell a chain step clears. It
  is small enough that a set of a dozen cells reads as a dozen bursts rather
  than one wash of color.
- The flawed detonation, a heavier one-shot thrown where a gem at `MAX_STRAIN`
  (`3`) clears. It reads as visibly bigger and more violent than the clear
  burst, so a chain tearing through a primed corner looks like the payoff it is.
- The cut-gem flash, a one-shot thrown where a `brilliant`, a `star`, or a
  `prism` is created, marking the new stone on the frame it arrives.
- The cut aura, a continuous system played at the cell of every `brilliant`,
  every `star`, and every `prism` standing on the board, for as long as that gem
  stands there. It runs on rather than firing once, so a cut stone is never
  still, and it is quiet enough that several on one board read as several auras
  rather than as a haze over the field. Strain raises no effect of its own: a
  cracked stone is read off the stone, and this is what makes the three cuts a
  chain earns feel like the prize they are.

Play them with the provided runtime. `@test-cabinet/particle-runtime` is already
a dependency of your project, so import it like any other dependency. For this
2D game use its `/canvas` binding and its `ParticleCanvasPlayer`: construct one
from a parsed `system.json` and your 2D canvas context, and advance it each
frame with your frame delta; it simulates the system and composites the
particles. The package's own types are the authoritative API, so read them for
the exact constructor and update signatures. Its pure `ParticleSimulator` is
also exported for compositing the particles yourself.

Because these systems are simulated, they vary from play to play, and that
variation is correct.

## Audio

Produce every sound the game plays with the audio tools and play the resulting
`.wav`s through the Web Audio API. Land them under `public/assets/audio/`.

The baked `sfx-sample` pack is `combat-core`, which carries impact and debris
material (`debris_glass`, `clang_metal`, `impact_metal_dry`, `snap_transient`,
and more) and no tuned material. So the pitched cues are synthesized with
`sfx-synth`, and `sfx-sample` layers a shatter body underneath the clear cue,
where its glass and impact material belongs.

- `sfx-synth` produces the `select`, `swap`, `refuse`, `land`, `flaw`, `cut`,
  `levelup`, and `gameover` cues, each a short sound with its own character:
  select and swap are light and mechanical, refuse is a flat dead stop, land is a
  low settling knock for a column of stone arriving at the bottom of a long fall,
  flaw is a dry crack, cut is bright and metallic, level-up rises, and game-over
  falls.
- `sfx-synth` also produces the chain ladder: `MAX_MULTIPLIER` (`8`) tones of
  one timbre, ascending in pitch in order. Chain step `1` plays the lowest tone
  and each further step the next one up, so a long chain climbs the ladder and
  holds on the highest tone once the multiplier has capped.
- `sfx-sample` produces the shatter body, a broad glass-and-debris hit layered
  under the chain ladder's tone so the `clear` cue lands with weight.
- `music` sequences over the baked `gm-lite` bank, whose `music_box`,
  `glockenspiel`, `vibraphone`, and `marimba` carry a bright, struck, glassy
  bed. Produce two pieces: a title theme with a hook, and a slower play bed that
  sits under a round without pulling attention off the board. `music` emits both
  a `.wav` (the ready asset you play) and a `.mid` score alongside it; play the
  `.wav`.

Load each `.wav` page-relative as above, decode it with the Web Audio API
(`decodeAudioData`), and play it on the event that fires it. Audio starts only
after the player has interacted with the page, and the mute toggle silences
everything at once.

## What you draw in code (no tool for these)

There is no `ui` or `paint` tool in the current environment, so the game's
chrome is drawn in code (canvas or DOM):

- The HUD: the score, the level, and the chain multiplier while a chain is
  resolving.
- The level meter, the bar that fills as the current level's score climbs
  toward its target.
- The menus, the overlays, and the state screens: title, how to play, paused,
  level clear, and game over.
- The pointer targets `specs/controls.md` names, including the `PAUSE` and
  `BACK` controls.
- The selection mark, and the refusal mark a rejected swap shows on its two
  cells.
- The debug overlay.

## Genuinely produce the assets

A build that draws its gems as code-drawn rounded rectangles, ships one sprite
per kind with the strain states tinted in code, drops a cleared gem with no
break animation, teleports a falling gem into its cell rather than dropping it,
paints a flat colored flash in place of the produced particle systems, leaves a
cut stone standing still, bundles downloaded art or a downloaded sound, or plays
silence or a hand-oscillated Web Audio stand-in in place of produced audio has
not met this contract, however exactly the rules are implemented.

Produce a real set of faceted gem sprites across all four strain states, real
break sheets and a real prism turn, real simulated particle systems, and real
produced sound and music, and wire those committed files into the game.
Everything the game shows and plays traces back either to a file you produced
with one of the six tools or to the chrome you drew in code above.

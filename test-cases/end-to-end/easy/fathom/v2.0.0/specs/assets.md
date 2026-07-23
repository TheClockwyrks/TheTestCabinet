# Fathom — Art assets (provided; use them)

Fathom ships with a fixed set of pre-drawn art assets, seeded into your project under
`assets/`. They are the canonical art for this game and are the same for every build;
your job is to build the game around them, not to redraw them.

You must render the game using these provided assets for every element they cover
(the forager, the three predators, the bonus drifter, the flare bloom, and the maze
tiles). Do not substitute your own creatures, tiles, or effect art for these; do not
restyle or recolor them. Elements that have no asset (listed at the end) you draw in
code as the other specs describe. Everything in this file is consistent with the
palette, grid, and behavior defined across the other specs; when this file gives a
measurement, it matches them.

## Loading the assets: they must work under any base path

The built site is not guaranteed to be served from the root of its origin. When the
finished build is played back it is mounted under a per-run sub-path (a path like
`/runs/<id>/build/`), not at the domain root. Your build must therefore run unchanged
at any base path: every URL it requests has to resolve relative to the page, not to
the origin root. This is the single most common way this build breaks, so get it
right:

- Never reference an asset by a root-absolute URL, anything with a leading `/`, such
  as `/assets/glimmerfin/0.png`. A root-absolute URL ignores the page's location and
  resolves against the origin root, so under a sub-path it points outside the build
  and 404s. A sprite loader that sets an image source to a string like
  `/assets/<name>/<i>.png` works when served from a root and fails the instant it is
  served from a sub-path.
- Reference assets relative to the document or module instead, so each URL resolves
  against wherever the page actually lives. Prefer letting your bundler resolve them:
  import each PNG, or use a bundler directory glob (for example Vite's
  `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`) and use the
  URLs it returns. A runtime `new URL('./assets/…', import.meta.url)` also works, but
  only if your bundler can statically resolve it; verify it emits every frame of every
  sheet (a path with more than one dynamic segment often bundles only a subset), or
  prefer the glob, which always does.
- Configure your bundler's base path to be relative. If it has a base or public-path
  setting, set it so the emitted JS, CSS, and asset URLs are all page-relative (for
  Vite, `base: './'`). The default of an absolute `/` base produces exactly the
  root-absolute references that break under a sub-path, for the entry script and
  stylesheet as well as the art.
- Nothing fixes a bad URL for you at serve time. When the build is served under a
  sub-path the host injects a `<base>` tag and rewrites root-absolute references in the
  static HTML, but that reaches only the markup it serves. It cannot touch a URL your
  JavaScript builds at runtime, and a `<base>` tag does not affect a root-absolute
  (`/…`) URL at all. Any path your code constructs is your responsibility.

This applies to every runtime request, the bundled JS and CSS and these art assets
alike, not just the art. The quickest self-check: serve your `dist/` from a non-root
sub-path (for example `http://localhost:8080/sub/path/`) and confirm the game still
loads with no 404s, not only from the server root.

## How the assets are organized

Every asset is a sprite sheet: a folder under `assets/` holding one separate PNG per
frame, named by its frame index (`0.png`, `1.png`, and so on). Frames are individual
files, never strips or regions of a larger image. Every PNG has a transparent
background (straight alpha); only the drawn pixels are opaque, so each composites
cleanly over the dark maze.

| Asset | Folder | Frames | Frame size | What it is |
| --- | --- | --- | --- | --- |
| Forager | `assets/glimmerfin/` | 8 (`0`–`7`) | 32×32 | The player character (sprite) |
| The Lanternjaw | `assets/lanternjaw/` | 16 (`0`–`15`) | 32×32 | Light-seeking predator (sprite) |
| The Gloamfin | `assets/gloamfin/` | 8 (`0`–`7`) | 32×32 | Sound-seeking predator (sprite) |
| The Flarefish | `assets/flarefish/` | 8 (`0`–`7`) | 32×32 | Flare-making predator (sprite) |
| The bonus drifter | `assets/drifter/` | 8 (`0`–`7`) | 32×32 | The harmless amber jellyfish (sprite) |
| Flare bloom | `assets/flare-bloom/` | 8 (`0`–`7`) | 128×128 | The Flarefish's radial flare (effect) |
| Maze tiles | `assets/trench-walls/` | 19 (`0`–`18`) | 32×32 | Wall autotile + floor + fog + den gate |

Two kinds, handled differently:

- Sprites and tiles (32×32) are drawn at one tile, `32×32` logical pixels, at their
  tile position. A creature sprite sits within its frame with a pixel or two of margin
  (so it reads as centered in the tile); a tile fills its cell edge to edge. These are
  pixel art: when the stage is scaled to the window, scale them with nearest-neighbor
  sampling (`image-rendering: pixelated` for DOM/CSS, `imageSmoothingEnabled = false`
  for Canvas) so they stay crisp and never blur.
- Effects (128×128) are area effects far larger than a tile. Draw each centered on its
  source and scaled so its lit radius matches the range the behavior specs give
  (below). Composite them additively (lighter / screen blend) over the maze so they
  read as light, not as opaque decals; smooth scaling is fine for these soft glows.

## The forager: `assets/glimmerfin/` (8 frames, 32×32)

The player character (`#46f0e0`). Four-direction movement with a two-frame chomp as
it grazes:

| Frames | Facing | First frame | Second frame |
| --- | --- | --- | --- |
| 0, 1 | down | mouth closed | mouth open |
| 2, 3 | up | mouth closed | mouth open |
| 4, 5 | left | mouth closed | mouth open |
| 6, 7 | right | mouth closed | mouth open |

- Pick the pair for the forager's current facing and alternate the two frames (about
  8 to 10 fps) while it moves, so it reads as chomping along the corridor; hold the
  mouth-closed frame when stopped.
- The sprite carries no glow: the forager's brightness and light pocket are a runtime
  effect you draw around the sprite (see `specs/gameplay.md`), not part of the art. The
  small lives icons in the HUD may reuse a forager frame.

## The Lanternjaw: `assets/lanternjaw/` (16 frames, 32×32)

The light-seeking predator (`specs/predators.md`). It has two forms: its true
anglerfish body (a dark hunter with jaws) that it wears while hunting, and a jellyfish
disguise it wears while wandering, so an undetected Lanternjaw passes for the harmless
bonus drifter. Both forms carry the same amber bulb, the glowing amber bell at the top
of the sprite, drawn pixel-identical to the bonus drifter's bell (the `drifter` sheet,
below). That shared bell is the anchor of the deception: whichever form shows, the
bulb sits in the same place and looks the same, and only what hangs beneath it differs
(the drifter's tendrils, or the hunting Lanternjaw's dark, gaping jaws, below the very
same bell). A reveal is thus purely additive: the bulb never jumps or changes; the
jaws (or tendrils) simply appear around it. The disguise frames are the same art as
the `drifter` sheet; the two must be pixel-identical, so author the jellyfish once and
place it in both sheets:

| Frames | Contents |
| --- | --- |
| 0, 1 | swim down (the true anglerfish: the shared amber bell over dark, gaping jaws, a two-frame chomp) |
| 2, 3 | swim up |
| 4, 5 | swim left |
| 6, 7 | swim right |
| 8–15 | the jellyfish disguise (an eight-frame tendril-sway loop, identical to `assets/drifter/` frames 0–7) |

- While the Lanternjaw is hunting (it has fixed on you and lunges), draw its facing
  pair from frames 0–7 and alternate them (about 6 to 8 fps); this is the moment it
  drops the disguise and its jaws show beneath the bulb.
- While it wanders (undetected), play the jellyfish disguise loop over frames 8–15,
  exactly as you animate the bonus drifter, so up close it is indistinguishable from a
  real drifter (`specs/predators.md`).
- On top of the bell baked into these frames, the always-visible amber bulb-light is
  also a runtime amber glow you draw at the creature's center (see "What has no asset"
  below), shown even when the body is unlit and drawn identically for the Lanternjaw
  and the drifter; it is what you see in the dark at any distance. The body itself is
  fog-gated like any predator and drawn from this sheet only where your light reveals
  it; a sonar pulse never draws it (`specs/gameplay.md`).

## The Gloamfin: `assets/gloamfin/` (8 frames, 32×32)

The eyeless, sound-hunting predator (`#c46bff`). Four-direction swim only:

| Frames | Facing |
| --- | --- |
| 0, 1 | down |
| 2, 3 | up |
| 4, 5 | left |
| 6, 7 | right |

Alternate the two frames of the current facing while it moves. The Gloamfin has no
eyes and a faint sonar cue at its head; its tell is the sonar ping it emits
(`specs/predators.md`), which is a separate procedural effect drawn in code (not a
sprite; see "What has no asset" below), not on this sheet.

## The Flarefish: `assets/flarefish/` (8 frames, 32×32)

The flare-making predator (`#ff7a59`). Four-direction swim only:

| Frames | Facing |
| --- | --- |
| 0, 1 | down |
| 2, 3 | up |
| 4, 5 | left |
| 6, 7 | right |

Alternate the two frames of the current facing while it moves. The sprite carries only
the small dim flare organ on its body; the flare itself is the separate large effect
below.

## The bonus drifter: `assets/drifter/` (8 frames, 32×32)

The harmless drifting jellyfish you graze for bonus points (`specs/gameplay.md`). An
amber bell (the "bulb") with a frilled skirt and a few tendrils hanging below, over an
eight-frame sway loop (the tendrils ripple gently as it drifts). It is directionless
(a jellyfish reads the same whichever way it drifts), so there is a single loop rather
than per-facing pairs; advance the loop (about 8 fps) while it moves.

- These are the very frames a wandering Lanternjaw wears as its disguise
  (`assets/lanternjaw/` 8–15): the jellyfish here and the disguise there must be
  pixel-identical, so a wandering Lanternjaw cannot be told from a real drifter up
  close. Author the jellyfish once and use it for both. The amber bell here is also the
  exact bulb baked into the Lanternjaw's hunting frames (0–7), so a revealed hunting
  Lanternjaw shows this same bell with jaws where the drifter has its tendrils; the
  reveal is purely additive (`specs/predators.md`).
- The bell reads as the bulb, but the always-visible amber point is the runtime glow
  drawn at the creature's center (see "What has no asset" below), the same glow the
  Lanternjaw's bulb uses, not this sprite. Like a predator body, the jellyfish is
  fog-gated: it is drawn from this sheet only where the drifter is currently lit (in
  your light, or a flare), so normally only the amber bulb shows in the dark, and the
  tendrils appear only up close. A sonar pulse does not reveal it: a ping leaves the
  amber bulb unchanged and never draws the jellyfish (`specs/gameplay.md`), so it can
  never be told from a Lanternjaw by pinging.

## The sonar pulse has no sprite: it is drawn in code

There is no sonar sprite sheet. The sonar pulse is a traveling wavefront that flows
outward through the corridors, bending around bends and reflecting off walls, so it
cannot be a fixed expanding circle; it must be rendered procedurally (see "What has no
asset" below and `specs/gameplay.md`). This is used both for the forager's ping (tinted
`#5ef2ff`) and, tinted to the Gloamfin's violet `#c46bff`, as the Gloamfin's tell,
except the Gloamfin's guaranteed "lost you" ping, tinted orange to set it apart from
its ordinary violet ping (`specs/predators.md`).

## The flare bloom: `assets/flare-bloom/` (8 frames, 128×128)

The Flarefish's flare: a warm radial burst in three beats (`specs/predators.md`).
Already warm-colored; composite additively, with no tint.

| Frames | Beat | Play it over |
| --- | --- | --- |
| 0, 1, 2 | charge-up (a small warm glow swelling toward a white core) | the roughly `0.5 s` charge-up that telegraphs the flare |
| 3, 4, 5 | bloom (a white-hot core ringed by warm light, widest and brightest at frame 5) | the roughly `1 s` bloom |
| 6, 7 | fade (the bloom collapses and dims) | the fade-out |

Center it on the Flarefish and scale frame 5 so its lit radius is about `192 px`
(6 tiles), the flare radius in `specs/predators.md`. The area the bloom lights is
revealed to the player per that spec (`specs/gameplay.md` governs how long it stays
revealed); the bloom sprite is the visual, the reveal is the behavior.

## The maze tiles: `assets/trench-walls/` (19 frames, 32×32)

The maze itself: the wall autotile, the corridor floor, the unrevealed fog, and the
den gate. These are tiles: each fills its `32×32` cell edge to edge (no margin) and
butts seamlessly against its neighbors.

Wall autotile (frames 0–15). The frame index is a connection bitmask of which sides
the wall continues to (where the neighboring cell is also a wall):

> N (up) = 1, E (right) = 2, S (down) = 4, W (left) = 8. Add the bits for the
> connected sides to get the frame index.

A connected side runs flush to that edge (merging with the neighbor); an open side
faces a corridor and gets a rounded raised rock face. For each wall cell, look at its
four orthogonal neighbors, set a bit for each that is also wall, and draw that frame.
(So a wall with wall above and below only is frame `5`, a vertical straight; wall on
left and right only is frame `10`, a horizontal straight; an isolated wall is frame
`0`.)

| Frame | Connected sides | Piece |
| --- | --- | --- |
| 0 | none | isolated pillar |
| 1 | N | bottom end of a vertical wall |
| 2 | E | left end of a horizontal wall |
| 3 | N, E | elbow |
| 4 | S | top end of a vertical wall |
| 5 | N, S | vertical straight |
| 6 | E, S | elbow |
| 7 | N, E, S | T-junction, open left |
| 8 | W | right end of a horizontal wall |
| 9 | N, W | elbow |
| 10 | E, W | horizontal straight |
| 11 | N, E, W | T-junction, open down |
| 12 | S, W | elbow |
| 13 | N, S, W | T-junction, open right |
| 14 | E, S, W | T-junction, open up |
| 15 | all | interior / fully enclosed |

Floor (frame 16). The revealed corridor floor (open water, `#0a1422`), seamless when
repeated; draw it under everything in every open (non-wall) cell.

Fog (frame 17). The unrevealed tile (`#03060c`): flat, featureless, darker than the
floor, drawn for any tile your light, a sonar pulse, or a flare has not yet revealed.
(Equivalently you may leave unrevealed cells as the flat fog background color; it is
the same value.)

Den gate (frame 18). The single gate tile on the den's top edge (`specs/maze.md`)
the predators pass through: a floor tile crossed by a barred threshold.

Visibility states are runtime shading, not separate tiles. The visibility states in
`specs/gameplay.md` are drawn by shading these same tiles: lit is the tile at full
brightness, and an unrevealed tile is the fog tile (or fog color). Any dimmed
in-between state a sensing model defines is the same wall or floor tile drawn dim.
Predators, the drifter, plankton, and effects are layered on top per the other specs.

## What has no asset: draw these in code

These are not provided and you render them yourself, exactly as the other specs
describe (using the palette in `specs/overview.md`):

- Plankton (`#b8f5c8` motes) (`specs/gameplay.md`).
- The sonar pulse: a traveling wavefront that flows outward through the corridors
  (bending around bends, reflecting off walls), drawn as a glowing crest of short arcs
  that bulge in the direction the sound is moving, brightest at the leading edge.
  Tinted `#5ef2ff` for the forager and `#c46bff` for the Gloamfin's ordinary ping, and
  orange for the Gloamfin's guaranteed "lost you" ping (a distinct tell; see
  `specs/gameplay.md`, `specs/predators.md`).
- The always-visible amber bulb-light, drawn identically for the bonus drifter and the
  Lanternjaw's bulb: a glowing amber mote (`#ffd166`) rendered at the creature's
  center, shown at all times even across unlit fog. It is the same runtime glow for
  both, so the two are indistinguishable at a distance; a drifter's jellyfish body and
  a wandering Lanternjaw's disguise (both from the sprite sheets above) only appear,
  and only up close, where your light reveals them, never by a sonar pulse, which
  leaves both showing only their bulb (`specs/gameplay.md`, `specs/predators.md`,
  `specs/gameplay.md`). In Kindle, this amber glow is clipped to your vision circle (see
  `specs/gameplay.md`).
- The detection alert: the bright flash burst (in the acquiring predator's color) that
  fires the instant a predator takes a fix: any Gloamfin acquisition (its own ping,
  your sonar reaching it, or its close-range hearing), the Flarefish's flare, or the
  Flarefish's ordinary light-sense catches you (`specs/predators.md`).
- The ink cloud (`#0b0a1f`) (`specs/gameplay.md`).
- The forager's brightness glow and the lit pocket of vision around it, and any
  predator glow at the edge of sight: these are runtime light, not sprite art
  (`specs/gameplay.md`).
- The entire HUD (score, mode label, lives readout, depth, the sonar and ink gauges)
  and all text, menus, panels, overlays, and the dive countdown
  (`specs/ui.md`).

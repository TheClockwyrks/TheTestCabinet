# Art assets (provided; use them)

Wireworm ships with a fixed set of pre-drawn sprite assets, seeded into your
project under `assets/`. They are the canonical art for this game and are the same
for every build; your job is to build the game around them, not to redraw them.

Render the game using these provided assets for every element they cover (the
nodes, the worm, the cursor, and the three foes). Do not substitute your own art
for these, and do not restyle or recolor them. Elements that have no asset (listed
at the end) you draw in code as the other specs describe. Everything in this file
is consistent with the grid, palette, and behavior defined across the other specs;
when this file gives a size, it matches them.

## Loading the assets so they work under any base path

The built site is not guaranteed to be served from the root of its origin. When
the finished build is played back it is mounted under a sub-path, not at the domain
root, so the build must run unchanged at any base path: every URL it requests has
to resolve relative to the page, not to the origin root.

- Never reference an asset by a root-absolute URL (anything with a leading `/`,
  such as `/assets/node/3.png`). A root-absolute URL resolves against the origin
  root, so under a sub-path it points outside the build and 404s.
- Reference assets relative to the document or module instead, so each URL resolves
  against wherever the page actually lives. Prefer letting your bundler resolve
  them: import each PNG, or use a bundler directory glob (for example Vite's
  `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`) and use
  the URLs it returns. A runtime `new URL('./assets/…', import.meta.url)` also
  works when your bundler can statically resolve it.
- Configure your bundler's base path to be relative, so the emitted JS, CSS, and
  asset URLs are all page-relative (for Vite, `base: './'`).

This applies to every runtime request: the bundled JS and CSS and these art assets
alike.

## How the assets are organized

Every asset is a folder under `assets/` holding one separate PNG per frame, named
by its frame index (`0.png`, `1.png`, …). Frames are individual files, never strips
or regions of a larger image. Every PNG is 32 x 32 with a transparent background
(straight alpha); only the drawn pixels are opaque, so each composites cleanly over
the dark board. They are pixel art: draw them at the 32 x 32 tile size with
nearest-neighbor sampling (`image-rendering: pixelated` for DOM/CSS,
`imageSmoothingEnabled = false` for Canvas) so they stay crisp and never blur when
the stage is scaled to the window.

| Asset | Folder | Frames | What it is |
| --- | --- | --- | --- |
| Node | `assets/node/` | 5 (`0`–`4`) | Capacitor node, one frame per charge state |
| Worm | `assets/worm/` | 6 (`0`–`5`) | The data-worm's tileable parts |
| Cursor | `assets/cursor/` | 1 (`0`) | The player's defrag cursor |
| Glitch | `assets/glitch/` | 4 (`0`–`3`) | The node-eating foe (flicker) |
| Dropper | `assets/dropper/` | 1 (`0`) | The packet-dropper foe |
| Corruptor | `assets/corruptor/` | 4 (`0`–`3`) | The charge-slamming foe (crawl) |

## The node — `assets/node/` (5 frames)

One frame per charge state (`specs/charge.md`), drawn at the node's tile:

| Frame | Charge | Draw for |
| --- | --- | --- |
| 0 | inert (`C = 0`) | a node with no charge |
| 1 | low (`C = 1`) | a node charged once |
| 2 | charged (`C = 2`) | a node charged twice |
| 3 | critical (`C = 3`) | a critical node |
| 4 | critical, pulse peak | the alternate critical frame |

Pick the frame for a node's current charge. For a critical node, alternate frames
`3` and `4` (about `6` fps) so it visibly pulses, marking it as loaded and ready to
detonate.

## The worm — `assets/worm/` (6 frames)

The data-worm's tileable parts (`specs/worm.md`). It faces right; mirror it
horizontally to draw a worm moving left.

| Frames | Part | Use |
| --- | --- | --- |
| 0, 1 | head (closed, chomp) | the leading segment; alternate `0`/`1` (about `5` fps) as it moves |
| 2, 3 | body (pose A, B) | every middle segment; alternate `2`/`3` (about `6` fps) for the crawl |
| 4, 5 | tail (pose A, B) | the trailing segment; alternate `4`/`5` (about `6` fps) |

Draw a worm by placing the head frame on its leading segment, the tail frame on its
trailing segment, and the body frames on every segment between; mirror the frames
when the segment is moving left. A one-segment worm is just the head.

## The cursor — `assets/cursor/` (1 frame)

The player's craft (`specs/controls.md`), drawn at the cursor's position in the
player band. It points up; draw it upright (do not rotate it).

## The glitch — `assets/glitch/` (4 frames)

The node-eating foe (`specs/foes.md`). Play frames `0` through `3` as a fast
flicker loop (about `10` fps) while it skitters, so it reads as unstable.

## The dropper — `assets/dropper/` (1 frame)

The packet-dropper foe (`specs/foes.md`), drawn at its position as it falls.

## The corruptor — `assets/corruptor/` (4 frames)

The charge-slamming foe (`specs/foes.md`). It faces right; mirror it to crawl left.
Play frames `0` through `3` as a crawl loop (about `8` fps) while it moves.

## What has no asset — draw these in code

These are not provided and you render them yourself, exactly as the other specs
describe (using the palette in `specs/overview.md`):

- The player's bolts, the upward shots (`specs/controls.md`): small bright `#57e0ff`
  streaks.
- The chain-arc discharge, the bright `#b8ffe6` lightning arcing between detonating
  nodes and the flash of a detonation (`specs/charge.md`). This is an animated
  effect, not a sprite.
- The board: the dark background, the faint trace grid, and the tinted player band
  (`specs/board.md`, `specs/overview.md`).
- The entire HUD (score, lives, level, hazard indicator) and all text, menus,
  panels, and overlays (`specs/ui.md`).

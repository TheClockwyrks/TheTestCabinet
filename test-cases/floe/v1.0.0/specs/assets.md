# Art assets (provided; use them)

Floe ships with a **fixed set of pre-drawn sprite assets**, seeded into your project
under **`assets/`**. They are the canonical art for this game and are the **same
for
every build** — your job is to build the game *around* them, not to redraw them.

**You must render the game using these provided assets** for every element they
cover (the critter, the bear, the snow plow, the dogsled, the car, and the floes).
Do **not**
substitute your own art for these, and do not restyle or recolor them. Elements
that
have **no** asset (listed at the end) you draw in code as the other specs describe.
Everything in this file is consistent with the grid, palette, and behavior defined
across the other specs — when this file gives a size, it matches them.

## Loading the assets — they must work under any base path

The built site is **not guaranteed to be served from the root of its origin.** When
the finished build is played back it is mounted under a **per-run sub-path** (a
path
like `/runs/<id>/build/`), not at the domain root. Your build must therefore run
**unchanged at any base path** — every URL it requests has to resolve relative
to the
page, not to the origin root. This is the single most common way this kind of build
breaks, so get it right:

- **Never reference an asset by a root-absolute URL** — anything with a leading
  `/`,
  such as `/assets/bear/0.png`. A root-absolute URL ignores the page's location
  and
  resolves against the origin root, so under a sub-path it points outside the build
  and 404s. A sprite loader that sets an image source to a string like
  `/assets/<name>/<i>.png` works when served from a root and fails the instant
  it is
  served from a sub-path.
- **Reference assets relative to the document or module instead**, so each URL
  resolves against wherever the page actually lives. Prefer letting your bundler
  resolve them: import each PNG, or use a bundler directory glob (for example Vite's
  `import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })`) and
  use
  the URLs it returns. A runtime `new URL('./assets/…', import.meta.url)` also works,
  but only if your bundler can statically resolve it — verify it emits **every**
  frame
  of every folder.
- **Configure your bundler's base path to be relative.** If it has a
  base/public-path setting, set it so the emitted JS, CSS, and asset URLs are all
  page-relative (for Vite, `base: './'`). The default of an absolute `/` base produces
  exactly the root-absolute references that break under a sub-path — for the entry
  script and stylesheet as well as the art.
- **Nothing fixes a bad URL for you at serve time.** When the build is served
  under a
  sub-path the host injects a `<base>` tag and rewrites root-absolute references
  in the
  **static HTML** — but that reaches only the markup it serves. It **cannot**
  touch a
  URL your JavaScript builds at runtime, and a `<base>` tag does not affect a
  root-absolute (`/…`) URL at all. Any path your code constructs is your
  responsibility.

This applies to **every** runtime request — the bundled JS and CSS and these art
assets alike. The quickest self-check: serve your `dist/` from a non-root sub-path
(e.g. `http://localhost:8080/sub/path/`) and confirm the game still loads with no
404s, not only from the server root.

## How the assets are organized

Every asset is a **folder** under `assets/` holding one **separate PNG per frame**,
named by its frame index (`0.png`, `1.png`, …). Frames are individual files, never
strips or regions of a larger image. Every PNG has a **transparent background**
(straight alpha) — only the drawn pixels are opaque, so each composites cleanly
over
the ice and water. They are **pixel art**: draw them with **nearest-neighbor**
sampling (`image-rendering: pixelated` for DOM/CSS, `imageSmoothingEnabled = false`
for Canvas) so they stay crisp and never blur when the stage is scaled to the window.

Note the **frame sizes differ** — the critter, bear, and small floe are one tile
(`32×32`), but the vehicles and rafts are **wider** (they span several tiles). Draw
each at its native pixel size at the correct tile position:

| Asset | Folder | Frames | Frame size | Spans |
| --- | --- | --- | --- | --- |
| Crosser (player) | `assets/crosser/` | 8 (`0`–`7`) | 32×32 | 1 tile |
| Bear (hunter) | `assets/bear/` | 12 (`0`–`11`) | 32×32 | 1 tile |
| Snow plow | `assets/plow/` | 1 (`0`) | 96×32 | 3 tiles |
| Dogsled | `assets/dogsled/` | 1 (`0`) | 64×32 | 2 tiles |
| Car | `assets/car/` | 1 (`0`) | 64×32 | 2 tiles |
| Floe — small | `assets/pan/` | 1 (`0`) | 32×32 | 1 tile |
| Floe — rafts | `assets/raft/` | 2 (`0`–`1`) | 128×32 | 3 or 4 tiles |

## The crosser — `assets/crosser/` (8 frames, 32×32)

The player critter (`specs/controls.md`). A two-frame hop per facing — a crouch
and a
leap:

| Frames | Facing | Play |
| --- | --- | --- |
| 0, 1 | down | crouch, then leap — alternate while hopping down |
| 2, 3 | up | crouch, then leap |
| 4, 5 | left | crouch, then leap |
| 6, 7 | right | crouch, then leap |

Pick the pair for the critter's current facing; show the crouch frame at rest
and play
crouch→leap as it hops. When the critter is resting in a filled bay, a crouch frame
works as its icon; the small **lives** icons in the HUD may reuse a crouch frame.

## The bear — `assets/bear/` (12 frames, 32×32)

The hunter (`specs/hunter.md`). A four-direction run, a submerged swim, and a lunge:

| Frames | Pose | Play |
| --- | --- | --- |
| 0, 1 | run **down** | two-frame cycle while it hops down |
| 2, 3 | run **up** | two-frame cycle |
| 4, 5 | run **left** | two-frame cycle |
| 6, 7 | run **right** | two-frame cycle |
| 8, 9 | **swim** (submerged) | play while the bear is in the water — the submerged silhouette + wake |
| 10, 11 | **lunge** | the strike, as it reaches and catches the critter |

Draw the bear with the run frame for its current heading while on ice or a floe;
use
the **swim** frames whenever it is over open water, so its position stays
readable as
a silhouette and wake (`specs/hunter.md`); and play the **lunge** as it catches
the
critter. The bear is a big animal — it fills its tile.

## The snow plow — `assets/plow/` (1 frame, 96×32, 3 tiles)

An ice-band hazard (`specs/hazards.md`): a long snow plow spanning **three tiles**.
Draw it 96 px wide at its lane position. It faces right; **mirror it** to face a
left-moving lane. Every tile it covers is deadly.

## The dogsled — `assets/dogsled/` (1 frame, 64×32, 2 tiles)

An ice-band hazard (`specs/hazards.md`): a sled-dog team spanning **two tiles**.
Draw
it 64 px wide at its lane position. It faces right; mirror it for a left-moving
lane.
Every tile it covers is deadly.

## The car — `assets/car/` (1 frame, 64×32, 2 tiles)

An ice-band hazard (`specs/hazards.md`): an ordinary sedan spanning **two tiles**.
Draw it 64 px wide at its lane position. It faces right; mirror it for a left-moving
lane. Every tile it covers is deadly.

## The floes — `assets/pan/` and `assets/raft/`

The water-band platforms (`specs/water.md`):

- **Small floe — `assets/pan/` (1 frame, 32×32).** One tile. Use it for single-tile
  floes; two pans may sit side by side for a two-tile stretch.
- **Rafts — `assets/raft/` (2 frames, 128×32).** The **solid** long floes. Frame
  `0`
  is the **three-tile** floe, drawn in the **left 96×32** of the image (the
  right tile
  is transparent); frame `1` is the **four-tile** floe, filling the full 128×32.
  Draw a
  three-tile floe from frame `0` (its left 96 px) and a four-tile floe from
  frame `1`.
  Each raft is one continuous piece — **do not** tile the small pan across a
  long floe;
  use the raft sprite so a wide floe reads as one solid slab.

## What has no asset — draw these in code

These are **not** provided and you render them yourself, exactly as the other specs
describe (using the palette in `specs/overview.md`):

- The **strait** itself: the deadly water, the pale ice of the shores, median,
  and ice
  band, the tile grid, and the glowing **goal bays** (`specs/playfield.md`).
- The **splash / spray** when the critter drowns or is crushed, and the bear's **wake**
  ripple on the water beyond what the swim frames carry.
- The entire **HUD** (score, lives, level, timer, bay markers) and **all text, menus,
  panels, and overlays** (`specs/flow.md`).

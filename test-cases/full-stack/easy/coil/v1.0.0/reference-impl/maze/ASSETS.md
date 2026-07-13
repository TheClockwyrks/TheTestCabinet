# Coil — Produced assets

Coil ships with **no** pre-made art or sound. The snake's whole sprite set and the game's
audio were **produced** with the on-`PATH` asset-generation tools (`draw`, `draw-sheet`,
`sfx-synth`, `music`) during the build and committed under [`assets/`](assets/); everything
else (the board, walls, obstacles, pellet, and HUD) is drawn in code. This is the production
contract from [`../../specs/assets.md`](../../specs/assets.md).

The build is **self-contained**: `npm run build` bundles the committed files and never invokes
the tools (they are on the `PATH` only while the run is live). The two scripts that produced
the assets are kept for provenance and are **not** run at build time:

- [`scripts/gen-sprites.sh`](scripts/gen-sprites.sh) — the snake sprite set (`draw` / `draw-sheet`).
- [`scripts/gen-audio.sh`](scripts/gen-audio.sh) — the sound cues and music bed (`sfx-synth` / `music`).

Only the finished `.png` / `.wav` / `.mid` under `assets/` are committed; the tools' throwaway
op-logs, configs, and previews are git-ignored.

## Canonical orientations (authored once, rotated/flipped in code)

Each sprite is a **32×32** straight-alpha PNG (one cell), authored in **one** canonical
orientation. The game covers all four travel directions and the four bends by rotating/flipping
the single sprite (`src/render.ts`), so there is exactly one PNG per shape — never one per
direction. Colours are the Coil palette from [`../../specs/overview.md`](../../specs/overview.md)
(head `#5ef38c`, body `#2fd07a`, dimmer than the head).

### `assets/snake/head/{0,1,2,3}.png` — `draw-sheet` (4 frames)

The animated head, authored **facing EAST** (mouth on the right/`+col` edge): a neon head with a
dark outline, a forward-looking eye, and a mouth on the east edge. Its **back is the same tube
cross-section as `body.png`** — the full-width `y6..25`/`y8..23` band, flush to the west edge —
so the head butts seamlessly against the neck segment behind it (it is **not** a free-floating
disc); from that neck-width back it swells to a fatter, rounded, blunt-nosed head toward the
east. Because the connecting band is centred and matches the body, the seam stays continuous
whichever way the head is rotated.

- **Frame 0** — resting (mouth closed).
- **Frames 1, 2, 3** — a bite: the mouth opens, chomps wide, and closes.

In game the head sprite is rotated to the snake's current facing; the bite (1→2→3, then back to
0) plays on the eat tick, advanced on a timer, then returns to rest.

### `assets/snake/body.png` — `draw`

A straight body segment authored **horizontal** (a tube running west↔east, connecting the west
and east edges), with a top shine and a bottom shade for volume and faint **scale chevrons**
pointing west (tail-ward, since the head is authored east). Clearly dimmer than the head. The
renderer orients it to the run direction so the chevrons flow toward the tail.

### `assets/snake/corner.png` — `draw`

A 90° bend authored so its two open ends are **EAST (the head-ward arm) and SOUTH (the tail-ward
arm)** — an L that curves the tube between the right and bottom edges. It carries the **same
scale chevrons as the straight body, following the L** (west along the east arm, south along the
south arm) so the scales flow continuously around the bend. Used at every bend; the renderer maps
this canonical corner onto each bend by sending its east opening to the head neighbour and its
south opening to the tail neighbour (a rotation, or a rotation+reflection when the bend turns the
other way), so a turning snake reads as a continuous coil — head, straights, and corners all
scaling tail-ward — rather than a staircase of squares.

### `assets/snake/tail.png` — `draw`

The final segment, authored connecting on its **WEST** edge and **tapering to a point at the
EAST tip** (tip points `+col`/east). Rotated so the taper points along the tail's outgoing
direction.

## Audio

Played via the Web Audio API (`decodeAudioData`); nothing autostarts before the first user
gesture, and a `M` mute toggle is provided (persisted to `coil.muted`). All playback is guarded
so a decode/autoplay failure never breaks the game.

- `assets/audio/eat.wav` — `sfx-synth`: a short bright blip on a pellet eaten.
- `assets/audio/combo.wav` — `sfx-synth`: a brighter/higher blip when the combo multiplier rises.
- `assets/audio/death.wav` — `sfx-synth`: a distinct descending tone on a fatal collision.
- `assets/audio/music.wav` (+ `assets/audio/music.mid`) — `music`: a low-key A-minor looping
  background bed on synth-waveform tracks. The `.wav` is played and loops under the round; the
  `.mid` is kept as a portable companion score.

## Loading rule

Assets are loaded **page-relative** through Vite import globs
(`import.meta.glob('../assets/**/*.png', { eager: true, query: '?url' })` and the same for
`*.wav`), and `vite.config.ts` sets `base: './'`, so every URL resolves under any base path —
never a root-absolute `/assets/…` URL that would 404 under a per-run sub-path. Sprites are
sampled nearest-neighbour so the pixel art stays crisp at any scale.

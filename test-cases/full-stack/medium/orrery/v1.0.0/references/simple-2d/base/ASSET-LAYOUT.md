# Orrery — asset layout (the canonical committed asset set)

This is the map of every **produced** asset the game loads: where each file lands under
[`assets/`](assets/), its realized size, count, and duration, which `scripts/gen-*`
script produces it, and the loader key it is consumed under. It is the companion to the
production **contract** in `specs/assets.md`: the spec says _what_ to produce and why;
this file records _where it lands and how it is wired in_.

Everything here was produced **once** with the on-`PATH` tools (`draw`, `draw-sheet`,
`particle-2d`, `sfx-sample`, `sfx-synth`, `music`) and **committed**. `npm ci` and
`npm run build` are self-contained: they bundle these committed files and never invoke a
tool. Re-run a `scripts/gen-*` script to regenerate its group — each resolves its tools
from `PATH`, falling back to `$CARGO_TARGET_DIR/{release,debug}`; see each script's
header for what it produces and the look it works to.

| Group              | Script                   | Files                       | On disk |
| ------------------ | ------------------------ | --------------------------- | ------- |
| Sprites and sheets | `scripts/gen-sprites.sh` | 45 stills + 12 sheet frames | 264 KB  |
| Particle systems   | `scripts/gen-fx.sh`      | 3 `system.json`             | 20 KB   |
| Audio              | `scripts/gen-audio.sh`   | 7 `.wav` + 1 `.mid`         | 6.2 MB  |

## The look everything is held to

**A brass instrument under a night sky** (`specs/assets.md` "The look"): worked metal,
cut glass, and the cold light of the bodies the machine handles. The machine — hubs,
grippers, wheel, mount, filaments, engraved sigils — is brass in one warm ramp; the
motes alone carry saturated color, because they are the light in the scene; and the one
alarm color, `#e2664f`, belongs to a fault and to nothing else. The ramp matches
`src/theme.ts`, which fixes what the build draws in code, so a produced sprite and the
chrome around it read as one place. The palette lives once, in
`scripts/sprites/palette.mjs`.

## How assets are keyed

**The loader key of a file is its path under `assets/`** — the string
`src/constants.ts` holds (`MOTE_SPRITE_PATHS`, `APERTURE_SHEETS`, `PARTICLE_PATHS`,
`CUE_PATHS`, and the rest), written relative to that root and never rooted at `/`. The
engine's asset loader resolves each one under the single root it was given (`assets/`,
its default) **relative to the page**, so `dist/` runs unchanged from a host's root and
from a sub-path alike, and this build constructs no URL of its own. `public/assets` is a
symlink to `assets/`, which is how Vite copies the committed set into `dist/assets/`
untouched — byte for byte the files below, at the paths below.

Three lanes come out of that one root, and each is awaited inside `initialize`, so every
file is decoded before the first frame draws:

- **Sprites and sheet frames** — `src/assets.ts` asks `api.assets.loadImage(path)` for
  each, and `src/images.ts` holds what came back in one store keyed by that same path.
  `src/render.ts` and the drawing modules ask the store for a path and are handed the
  decoded image or `null`.
- **Particle systems** — `src/assets.ts` asks `api.assets.load(path)` for each of the
  three `system.json` documents and parses it; `src/effects.ts` holds them by name and
  plays them.
- **Sounds** — `src/audio.ts` declares each of the seven names in `CUES` as a
  synthesized shape and then binds the produced file over it with
  `api.audio.load(cue, CUE_PATHS[cue])`. The cue's key is its name in `CUES`; the file
  it plays is its entry in `CUE_PATHS`.

A failed load leaves the game running: a sprite that did not decode falls back to
what `src/fielddraw.ts` draws in code, an absent system plays no effect, and a
sound that did not decode leaves its cue silent (`specs/assets.md` "Where the
files land").

## Sprites — `scripts/gen-sprites.sh`

All are transparent straight-alpha RGBA PNGs, authored at the native canvas
`specs/assets.md` pins and drawn at that size in logical units, so nothing is scaled at
draw time. Each sprite is composed as a pixel raster under `scripts/sprites/` and handed
to `draw` as the runs of `fill-rect` operations that reproduce it, so the committed file
is the tool's own render of its own action log (8,885 tool operations in all).

| Files                              | Canvas  | Count | Loader key                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------- | ----- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprites/motes/<type>.png`         | 44 x 44 | 15    | `MOTE_SPRITE_PATHS[type]`       | One per name in `MOTES`. Told apart by **silhouette** first — `dust` a scatter of grains, `nebula` a lumpy cloud, `comet` a cut hexagonal crystal, `nova` an eight-point burst, `meteor` an irregular cratered rock, `mercury` a hanging quicksilver droplet, `umbra` a black body with a violet limb, `lumen` its radiant opposite, `aether` a disc quartered into the four essences — then by hue. The six planets are deliberately ONE family (a lit banded orb) and carry a countable **rung**: bright pips on the arc above, one for `saturn` up to six for `sol`, so the ladder order of `PLANETS` is read off the sprite. `saturn` also wears its ring, painted in two halves with the body between them. Every painted pixel is clipped to 20 px of center, so the `MOTE_R` (22) guarantee holds whether a checker measures a pixel's center or its index. 60 KB total. |
| `sprites/filaments/plain.png`      | 48 x 16 | 1     | `FILAMENT_SPRITE_PATHS.plain`   | One brass wire between two end collars, spanning the full `HEX_PITCH` (48). 426 B.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sprites/filaments/triune.png`     | 48 x 16 | 1     | `FILAMENT_SPRITE_PATHS.triune`  | Three wires bound by five collars into a cable more than three times as deep as the plain strip — the "clearly heavier" the bar asks for, read across a whole field. 1.4 KB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sprites/sigils/<kind>.png`        | 48 x 48 | 12    | `SIGIL_GLYPH_PATHS[kind]`       | One per transforming sigil, `bind` through `void`. All twelve share one engraved treatment — a thin ring at the hex's edge with six ticks on the `DIRS` bearings — and differ by a mark built out of the sigil's own effect: `bind` two nodes and one bar, `triune` the same pair under three, `sunder` the bar broken and struck through in the alarm color, `wane` a body dissolving into grains, `mirror` a filled essence copied across an axis into a hollow one, `ascend` three chevrons climbing off a quicksilver bead, `conjoin` two founts merging into one crown, `eclipse` a dark body inside a corona, `confluence` four colored arrows drawn INWARD to a filled crown, `dispersion` the same four reversed OUTWARD from a hollow one, `void` a spiral winding into a black maw. 48 KB total.                                                                      |
| `sprites/instructions/<name>.png`  | 24 x 24 | 10    | `INSTRUCTION_GLYPH_PATHS[name]` | One per name in `INSTRUCTIONS`. Carried by three tells at once so none is load-bearing alone: SHAPE (jaws, a concentric ring, an arc about an off-center pivot bead, a shaft leaving or entering a fixed block, a carriage over a laid track), COLOR (brass for the grip pair, pale gold for the rotations, cold steel-blue for the pivots, ember for the piston pair, pale lavender for the track pair), and HAND (the arrowhead at the opposite end of the same figure within a pair). 40 KB total.                                                                                                                                                                                                                                                                                                                                                                           |
| `sprites/parts/hub-arm.png`        | 40 x 40 | 1     | `HUB_PATHS.arm`                 | A round brass bearing plate, eight bolts, with a keyed nose along `DIRS[0]` so the rotation reads. Authored pointing east and turned to the part's first spoke at draw time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sprites/parts/hub-piston.png`     | 40 x 40 | 1     | `HUB_PATHS.piston`              | The same family, a different silhouette: a cut-cornered square sleeve with three telescoping bands and a barrel out its nose. Told from the arm hub at a glance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sprites/parts/gripper-open.png`   | 32 x 32 | 1     | `GRIPPER_PATHS.open`            | A broken C with a 76-degree mouth toward `DIRS[0]` and both jaw tips splayed clear.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sprites/parts/gripper-closed.png` | 32 x 32 | 1     | `GRIPPER_PATHS.closed`          | An unbroken O with a bright knuckle where the tips met, hugging what the gripper holds. C-versus-O survives all six spoke angles, which is what "reads as closed at any of the six spoke angles" needs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `sprites/parts/wheel-hub.png`      | 48 x 48 | 1     | `WHEEL_HUB_PATH`                | The zodiac dial: a 24-tooth rim, six spokes on the `DIRS` bearings out to the fixture ring with spoke 0 drawn brighter and wider (the rotation tell), and an engraved six-point star at the middle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sprites/parts/fixture-mount.png`  | 48 x 48 | 1     | `FIXTURE_MOUNT_PATH`            | The cradle one fixture rides in: a bolted collar with four claws reaching in over the mote's rim, its middle left clear because the mount is drawn BENEATH the mote sprite. This is what makes a fixture read as mounted on its wheel rather than as resting loose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The six part pieces total 24 KB.

### The sheets

Emitted as **separate numbered PNGs**, not as regions of one image. Each sheet is two
sheet-wide layers painted once — an outer ring of six blades and an inner iris — which
`draw-sheet` spins with rotation keyframes, the blades one way and the iris the other,
so the mechanism reads as geared. Both motifs carry **six-fold** rotational symmetry and
each frame advances **10 degrees**, so frame 5 lands 50 degrees on and frame 5 into
frame 0 closes the remaining 10: six distinct rasters that come round into one
continuous turn rather than a flicker.

| Files                               | Canvas  | Frames | Loader key             | What it is                                                                                                                                          |
| ----------------------------------- | ------- | ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprites/apertures/rise/{0..5}.png` | 48 x 48 | 6      | `APERTURE_SHEETS.rise` | An **entrance**: warm brass vanes with their chevrons pointing OUT, around an iris of fire opening onto the field. The ring turns clockwise. 24 KB. |
| `sprites/apertures/set/{0..5}.png`  | 48 x 48 | 6      | `APERTURE_SHEETS.set`  | An **exit**: cold steel vanes with their chevrons pointing IN, around a dark toothed maw. The ring turns the other way. 24 KB.                      |

Each rise and set on the field shows frame
`floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet;
`APERTURE_FRAME_TIME` is `0.12` s, so one turn takes 0.72 s.

## Particle systems — `scripts/gen-fx.sh`

Each is a simulated `system.json` played live through `@clockwyrks/particle-runtime`'s
`./canvas` binding, on the same context the field is drawn into; every play varies. All
three are authored **radially symmetric** (centered point/disc emitters, 360-degree
cones, no gravity and no wind — only radial push or pull, drag, and a symmetric vortex)
on a neutral 128 x 128 field, so an instance reads correctly on any of the ninety-one
hexes; placing and scaling an instance at its event's position stays the build's code.
All three are one-shot (`loop: false`) and decay to empty.

| File                      | Field                 | Length  | Loader key                | Fired at                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------- | ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `particles/deliver.json`  | 128 x 128, 3 emitters | 620 ms  | `PARTICLE_PATHS.deliver`  | Each set that consumed at least one accepted constellation at this boundary, on its anchor hex. The short, frequent one: a brass flash on the aperture, a ring of gold sparks hauled INWARD by a negative radial (the set taking the constellation in), and a few motes that escape. 3.6 KB.   |
| `particles/fault.json`    | 128 x 128, 3 emitters | 900 ms  | `PARTICLE_PATHS.fault`    | The mote the fault names — lowest in `y`, then lowest in `x` — or the anchor hex of the part it names. The one effect that leaves the brass palette: a hard white strike collapsing to the alarm red, fast stretched shards, and dark smoke that hangs after everything else has gone. 3.6 KB. |
| `particles/complete.json` | 128 x 128, 4 emitters | 1500 ms | `PARTICLE_PATHS.complete` | Hex `(0, 0)`, on the boundary the run completes. The biggest and slowest: a white-gold bloom, a wide brass shockwave shell, a long vortex swirl of gold motes, and a scatter of cold glass glints for the sky the machine works under. 4.7 KB.                                                 |

## Audio — `scripts/gen-audio.sh`

44.1 kHz PCM-16 throughout, decoded with the Web Audio API. The palette is a **brass
instrument shop under a night sky**: seated brass, sprung latches, a servo taking up
load, struck metal, and glass bells.

Production lane per cue, as `specs/assets.md` allows: the four **machine** cues are
`sfx-sample` over the baked pack (the thing they report is a mechanism moving, and the
pack's own latches, ratchets, servos and struck metal carry that better than an
oscillator), each with a synth voice layered on top for the tuning; the two **celestial**
cues are pure `sfx-synth` (what they report is light, not metal); and the bed is
sequenced with `music` over the baked instrument bank.

| File                         | Length   | Ch     | Peak  | Cue                  | Character                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------- | ------ | ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio/place.wav`            | 0.114 s  | mono   | 0.52  | `CUES.place`         | `sfx-sample` — a spring latch seating, pitched up, with a triangle pinging UP a fifth over it. The brightest cue in the game (spectral centroid ≈ 2560 Hz) and the shortest; it fires on every drag.                                                                                                                                                             |
| `audio/erase.wav`            | 0.227 s  | mono   | 0.36  | `CUES.erase`         | `sfx-sample` — the same shop, the opposite gesture: a dull clank pitched DOWN, a triangle sliding a fifth DOWN, and a lowpass taking the brightness off (centroid ≈ 1780 Hz). Told from `place` with the eyes shut.                                                                                                                                              |
| `audio/start.wav`            | 0.900 s  | stereo | 0.32  | `CUES.start`         | `sfx-sample` — a machine taking up motion: a sprung ratchet lets go, a servo spins up under it, and a triangle-and-saw pair climbs A3 → E4 as the drive engages.                                                                                                                                                                                                 |
| `audio/halt.wav`             | 1.378 s  | stereo | 0.83  | `CUES.halt`          | `sfx-sample` — struck iron and the drive dying: a ring-modded clang, a saw collapsing two octaves, a sub thud underneath. The LOUDEST and lowest cue, and every voice in it FALLS.                                                                                                                                                                               |
| `audio/constellation.wav`    | 0.560 s  | stereo | 0.30  | `CUES.constellation` | `sfx-synth` — a two-bell chime, E5 up to A5, the same FM glass voice `complete` uses. Deliberately one step of what `complete` finishes: quieter, a third the length, and it sits UNDER it.                                                                                                                                                                      |
| `audio/complete.wav`         | 1.600 s  | stereo | 0.54  | `CUES.complete`      | `sfx-synth` — the reward: the glass bells climbing A4 · C5 · E5 · A5 · C6 over a brass swell, with a long shimmer tail. Nothing in it falls, which is what keeps it from ever being heard as `halt`.                                                                                                                                                             |
| `audio/music.wav` (+ `.mid`) | 32.000 s | stereo | 0.086 | `CUES.music`         | `music` over the bank: cello drone, string pad, vibraphone escapement, a music box far back, and a sine sub. 60 BPM, 4/4, eight bars in open fifths (A minor, then F) that never resolve. Mixed well under every cue — its peak is under a third of the quietest one. The `.mid` is the score it was sequenced from, committed beside the `.wav` the game plays. |

`music.wav` runs **32.000 s**, clearing `MUSIC_MIN_SECONDS` (30) with two to spare. Its
loop seam is authored twice over: the drone and the sub are held to beat 32 so the
rendered file is exactly one turn of the grid, both end on a `swell` (at silence when it
closes), and the two bell tracks that would otherwise ring past the boundary carry no
reverb of their own. The realized seam is **0.00064** of full scale in both channels,
against a `LOOP_SEAM_TOLERANCE` of `0.01`.

# Orrery — asset layout (the canonical committed asset set)

This is the map of every **produced** asset the game loads: where each file lands under
[`assets/`](assets/), its realized size, count, and duration, which `scripts/gen-*`
script produces it, and the loader key it is consumed under. It is the companion to the
production **contract** in `specs/assets.md`: the spec says *what* to produce and why;
this file records *where it lands and how it is wired in*. All three reference builds
(`none`, `simple-2d`, `structured-2d`) commit this **identical** set; only the loading
lane differs, and this build's is the Structured 2D engine's own.

Everything here was produced **once** with the on-`PATH` tools (`draw`, `draw-sheet`,
`particle-2d`, `sfx-sample`, `sfx-synth`, `music`) and **committed**. `npm ci` and
`npm run build` are self-contained: they bundle these committed files and never invoke a
tool. Re-run a `scripts/gen-*` script to regenerate its group — each resolves its tools
from `PATH`, falling back to `$CARGO_TARGET_DIR/{release,debug}`; see each script's
header for what it produces and the look it works to.

| Group | Script | Files | On disk |
| --- | --- | --- | --- |
| Sprites and sheets | `scripts/gen-sprites.sh` | 45 stills + 12 sheet frames | 264 KB |
| Particle systems | `scripts/gen-fx.sh` | 3 `system.json` | 20 KB |
| Audio | `scripts/gen-audio.sh` | 7 `.wav` + 1 `.mid` | 6.2 MB |

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

**The loader key of a file is its path under `assets/`** — `sprites/motes/dust.png`,
`particles/deliver.json`, `audio/place.wav` — which is exactly how `src/constants.ts`
holds it (`MOTE_SPRITE_PATHS`, `PARTICLE_PATHS`, `CUE_PATHS`, and the rest) and exactly
what is handed to the engine. Nothing in this build resolves a URL of its own: the
Structured 2D engine's asset loader owns the `assets/` root and resolves every key under
it **page-relative**, never as a root-absolute `/assets/…`, so `dist/` runs unchanged
from a host's root and from a sub-path alike. Three lanes come out of that:

- **Sprites and sheet frames** are loaded once by `src/assets.ts` through
  `InitApi.assets.loadImage(key)`, from the game instance's `initialize`, before the one
  level opens — so a draw component constructed for that level reads each image as a
  plain value. They are held by their key, and `orrerySprites()` is what the drawing
  code asks.
- **Particle systems** are fetched with `InitApi.assets.load(key)` and parsed in the
  same pass; `src/fx.ts` plays each through `@test-cabinet/particle-runtime`'s
  `./canvas` binding, from a `DrawComponent` that takes its place in the layer order
  like any other picture.
- **Sounds** are bound to the engine's CUE BUS rather than to a graph of this build's:
  `src/audio.ts` declares each of the seven cue names with a synthesized fallback shape
  and then loads the produced `.wav` over the same name with `InitApi.audio.load(cue,
  key)`. The game thereafter plays a cue BY NAME on `world.audio`.

The produced tree reaches `dist/` through `public/assets`, a committed symlink to
`assets/`, which Vite copies verbatim into the built site. Nothing is inlined, renamed,
or hashed, so the key a constant holds is the path the built site serves.

A failed load leaves the game running: a sprite that did not decode falls back to
what `src/fielddraw.ts` draws in code, an absent system plays no effect, and a
sound that did not decode keeps the synthesized shape its cue was declared with
(`specs/assets.md` "Where the files land"). The build's own suite runs in Node,
where nothing can fetch or decode a produced file, so every test in it is that
check.

## Sprites — `scripts/gen-sprites.sh`

All are transparent straight-alpha RGBA PNGs, authored at the native canvas
`specs/assets.md` pins and drawn at that size in logical units, so nothing is scaled at
draw time. Each sprite is composed as a pixel raster under `scripts/sprites/` and handed
to `draw` as the runs of `fill-rect` operations that reproduce it, so the committed file
is the tool's own render of its own action log (8,885 tool operations in all).

| Files | Canvas | Count | Loader key | What it is |
| --- | --- | --- | --- | --- |
| `sprites/motes/<type>.png` | 44 x 44 | 15 | `sprites/motes/<type>.png` (`MOTE_SPRITE_PATHS[type]`) | One per name in `MOTES`. Told apart by **silhouette** first — `dust` a scatter of grains, `nebula` a lumpy cloud, `comet` a cut hexagonal crystal, `nova` an eight-point burst, `meteor` an irregular cratered rock, `mercury` a hanging quicksilver droplet, `umbra` a black body with a violet limb, `lumen` its radiant opposite, `aether` a disc quartered into the four essences — then by hue. The six planets are deliberately ONE family (a lit banded orb) and carry a countable **rung**: bright pips on the arc above, one for `saturn` up to six for `sol`, so the ladder order of `PLANETS` is read off the sprite. `saturn` also wears its ring, painted in two halves with the body between them. Every painted pixel is clipped to 20 px of center, so the `MOTE_R` (22) guarantee holds whether a checker measures a pixel's center or its index. 60 KB total. |
| `sprites/filaments/plain.png` | 48 x 16 | 1 | `sprites/filaments/plain.png` (`FILAMENT_SPRITE_PATHS.plain`) | One brass wire between two end collars, spanning the full `HEX_PITCH` (48). 426 B. |
| `sprites/filaments/triune.png` | 48 x 16 | 1 | `sprites/filaments/triune.png` (`FILAMENT_SPRITE_PATHS.triune`) | Three wires bound by five collars into a cable more than three times as deep as the plain strip — the "clearly heavier" the bar asks for, read across a whole field. 1.4 KB. |
| `sprites/sigils/<kind>.png` | 48 x 48 | 12 | `sprites/sigils/<kind>.png` (`SIGIL_GLYPH_PATHS[kind]`) | One per transforming sigil, `bind` through `void`. All twelve share one engraved treatment — a thin ring at the hex's edge with six ticks on the `DIRS` bearings — and differ by a mark built out of the sigil's own effect: `bind` two nodes and one bar, `triune` the same pair under three, `sunder` the bar broken and struck through in the alarm color, `wane` a body dissolving into grains, `mirror` a filled essence copied across an axis into a hollow one, `ascend` three chevrons climbing off a quicksilver bead, `conjoin` two founts merging into one crown, `eclipse` a dark body inside a corona, `confluence` four colored arrows drawn INWARD to a filled crown, `dispersion` the same four reversed OUTWARD from a hollow one, `void` a spiral winding into a black maw. 48 KB total. |
| `sprites/instructions/<name>.png` | 24 x 24 | 10 | `sprites/instructions/<name>.png` (`INSTRUCTION_GLYPH_PATHS[name]`) | One per name in `INSTRUCTIONS`. Carried by three tells at once so none is load-bearing alone: SHAPE (jaws, a concentric ring, an arc about an off-center pivot bead, a shaft leaving or entering a fixed block, a carriage over a laid track), COLOR (brass for the grip pair, pale gold for the rotations, cold steel-blue for the pivots, ember for the piston pair, pale lavender for the track pair), and HAND (the arrowhead at the opposite end of the same figure within a pair). 40 KB total. |
| `sprites/parts/hub-arm.png` | 40 x 40 | 1 | `sprites/parts/hub-arm.png` (`HUB_PATHS.arm`) | A round brass bearing plate, eight bolts, with a keyed nose along `DIRS[0]` so the rotation reads. Authored pointing east and turned to the part's first spoke at draw time. |
| `sprites/parts/hub-piston.png` | 40 x 40 | 1 | `sprites/parts/hub-piston.png` (`HUB_PATHS.piston`) | The same family, a different silhouette: a cut-cornered square sleeve with three telescoping bands and a barrel out its nose. Told from the arm hub at a glance. |
| `sprites/parts/gripper-open.png` | 32 x 32 | 1 | `sprites/parts/gripper-open.png` (`GRIPPER_PATHS.open`) | A broken C with a 76-degree mouth toward `DIRS[0]` and both jaw tips splayed clear. |
| `sprites/parts/gripper-closed.png` | 32 x 32 | 1 | `sprites/parts/gripper-closed.png` (`GRIPPER_PATHS.closed`) | An unbroken O with a bright knuckle where the tips met, hugging what the gripper holds. C-versus-O survives all six spoke angles, which is what "reads as closed at any of the six spoke angles" needs. |
| `sprites/parts/wheel-hub.png` | 48 x 48 | 1 | `sprites/parts/wheel-hub.png` (`WHEEL_HUB_PATH`) | The zodiac dial: a 24-tooth rim, six spokes on the `DIRS` bearings out to the fixture ring with spoke 0 drawn brighter and wider (the rotation tell), and an engraved six-point star at the middle. |
| `sprites/parts/fixture-mount.png` | 48 x 48 | 1 | `sprites/parts/fixture-mount.png` (`FIXTURE_MOUNT_PATH`) | The cradle one fixture rides in: a bolted collar with four claws reaching in over the mote's rim, its middle left clear because the mount is drawn BENEATH the mote sprite. This is what makes a fixture read as mounted on its wheel rather than as resting loose. |

The six part pieces total 24 KB.

### The sheets

Emitted as **separate numbered PNGs**, not as regions of one image. Each sheet is two
sheet-wide layers painted once — an outer ring of six blades and an inner iris — which
`draw-sheet` spins with rotation keyframes, the blades one way and the iris the other,
so the mechanism reads as geared. Both motifs carry **six-fold** rotational symmetry and
each frame advances **10 degrees**, so frame 5 lands 50 degrees on and frame 5 into
frame 0 closes the remaining 10: six distinct rasters that come round into one
continuous turn rather than a flicker.

| Files | Canvas | Frames | Loader key | What it is |
| --- | --- | --- | --- | --- |
| `sprites/apertures/rise/{0..5}.png` | 48 x 48 | 6 | `sprites/apertures/rise/<frame>.png` (`APERTURE_SHEETS.rise`) | An **entrance**: warm brass vanes with their chevrons pointing OUT, around an iris of fire opening onto the field. The ring turns clockwise. 24 KB. |
| `sprites/apertures/set/{0..5}.png` | 48 x 48 | 6 | `sprites/apertures/set/<frame>.png` (`APERTURE_SHEETS.set`) | An **exit**: cold steel vanes with their chevrons pointing IN, around a dark toothed maw. The ring turns the other way. 24 KB. |

Each rise and set on the field shows frame
`floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet;
`APERTURE_FRAME_TIME` is `0.12` s, so one turn takes 0.72 s.

## Particle systems — `scripts/gen-fx.sh`

Each is a simulated `system.json` played live through `@test-cabinet/particle-runtime`'s
`./canvas` binding, on the same context the field is drawn into; every play varies. All
three are authored **radially symmetric** (centered point/disc emitters, 360-degree
cones, no gravity and no wind — only radial push or pull, drag, and a symmetric vortex)
on a neutral 128 x 128 field, so an instance reads correctly on any of the ninety-one
hexes; placing and scaling an instance at its event's position stays the build's code.
All three are one-shot (`loop: false`) and decay to empty.

| File | Field | Length | Loader key | Fired at |
| --- | --- | --- | --- | --- |
| `particles/deliver.json` | 128 x 128, 3 emitters | 620 ms | `particles/deliver.json` (`PARTICLE_PATHS.deliver`) | Each set that consumed at least one accepted constellation at this boundary, on its anchor hex. The short, frequent one: a brass flash on the aperture, a ring of gold sparks hauled INWARD by a negative radial (the set taking the constellation in), and a few motes that escape. 3.6 KB. |
| `particles/fault.json` | 128 x 128, 3 emitters | 900 ms | `particles/fault.json` (`PARTICLE_PATHS.fault`) | The mote the fault names — lowest in `y`, then lowest in `x` — or the anchor hex of the part it names. The one effect that leaves the brass palette: a hard white strike collapsing to the alarm red, fast stretched shards, and dark smoke that hangs after everything else has gone. 3.6 KB. |
| `particles/complete.json` | 128 x 128, 4 emitters | 1500 ms | `particles/complete.json` (`PARTICLE_PATHS.complete`) | Hex `(0, 0)`, on the boundary the run completes. The biggest and slowest: a white-gold bloom, a wide brass shockwave shell, a long vortex swirl of gold motes, and a scatter of cold glass glints for the sky the machine works under. 4.7 KB. |

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

| File | Length | Ch | Peak | Cue name (loader key) | Character |
| --- | --- | --- | --- | --- | --- |
| `audio/place.wav` | 0.114 s | mono | 0.52 | `place` (`audio/place.wav`) | `sfx-sample` — a spring latch seating, pitched up, with a triangle pinging UP a fifth over it. The brightest cue in the game (spectral centroid ≈ 2560 Hz) and the shortest; it fires on every drag. |
| `audio/erase.wav` | 0.227 s | mono | 0.36 | `erase` (`audio/erase.wav`) | `sfx-sample` — the same shop, the opposite gesture: a dull clank pitched DOWN, a triangle sliding a fifth DOWN, and a lowpass taking the brightness off (centroid ≈ 1780 Hz). Told from `place` with the eyes shut. |
| `audio/start.wav` | 0.900 s | stereo | 0.32 | `start` (`audio/start.wav`) | `sfx-sample` — a machine taking up motion: a sprung ratchet lets go, a servo spins up under it, and a triangle-and-saw pair climbs A3 → E4 as the drive engages. |
| `audio/halt.wav` | 1.378 s | stereo | 0.83 | `halt` (`audio/halt.wav`) | `sfx-sample` — struck iron and the drive dying: a ring-modded clang, a saw collapsing two octaves, a sub thud underneath. The LOUDEST and lowest cue, and every voice in it FALLS. |
| `audio/constellation.wav` | 0.560 s | stereo | 0.30 | `constellation` (`audio/constellation.wav`) | `sfx-synth` — a two-bell chime, E5 up to A5, the same FM glass voice `complete` uses. Deliberately one step of what `complete` finishes: quieter, a third the length, and it sits UNDER it. |
| `audio/complete.wav` | 1.600 s | stereo | 0.54 | `complete` (`audio/complete.wav`) | `sfx-synth` — the reward: the glass bells climbing A4 · C5 · E5 · A5 · C6 over a brass swell, with a long shimmer tail. Nothing in it falls, which is what keeps it from ever being heard as `halt`. |
| `audio/music.wav` (+ `.mid`) | 32.000 s | stereo | 0.086 | `music` (`audio/music.wav`) | `music` over the bank: cello drone, string pad, vibraphone escapement, a music box far back, and a sine sub. 60 BPM, 4/4, eight bars in open fifths (A minor, then F) that never resolve. Mixed well under every cue — its peak is under a third of the quietest one. The `.mid` is the score it was sequenced from, committed beside the `.wav` the game plays. |

`music.wav` runs **32.000 s**, clearing `MUSIC_MIN_SECONDS` (30) with two to spare. Its
loop seam is authored twice over: the drone and the sub are held to beat 32 so the
rendered file is exactly one turn of the grid, both end on a `swell` (at silence when it
closes), and the two bell tracks that would otherwise ring past the boundary carry no
reverb of their own. The realized seam is **0.00064** of full scale in both channels,
against a `LOOP_SEAM_TOLERANCE` of `0.01`.

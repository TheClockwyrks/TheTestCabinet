# Kessler — asset layout (the canonical committed asset set)

This is the map of every **produced** asset the game loads: where each file lands under
[`assets/`](assets/), its native size and count, which `scripts/gen-*.sh` script produces
it, and the loader key it is consumed under. It is the companion to the production
**contract** in `specs/assets.md`: the spec says *what* to produce and why; this file
records *where it lands and how it is wired in*. All three reference builds (`none`,
`simple-2d`, `structured-2d`) commit this **identical** set.

Everything here was produced **once** with the on-`PATH` tools (`draw`, `draw-sheet`,
`particle-2d`, `sfx-synth`, `music`) and **committed**. `npm ci` and `npm run build` are
self-contained: they bundle these committed files and never invoke a tool. Re-run a
`gen-*.sh` script to regenerate its group (each script resolves its tools from `PATH`,
falling back to `$CARGO_TARGET_DIR/{release,debug}` — see each script's header).

## How assets are keyed

The loader key for a file is its path under `assets/` without the extension —
`sprites/planet.png` → `sprites/planet`, `audio/paddle-bounce.wav` → the
`paddle-bounce` cue. The ball's ordered frame set `sprites/ball/{0..5}.png` is gathered
and sorted by its trailing number. Every URL resolves **page-relative** (never a
root-absolute `/assets/…`), and a failed load degrades to the code-drawn fallback —
the game keeps running (specs/assets.md "Where the files land").

## Sprites — `scripts/gen-sprites.sh`

All transparent, straight-alpha, authored at native size for the 1 px / logical-unit
reference fit and drawn centered on their object with no draw-time scaling.

| Files | Native size | Count | Loader key | Notes |
| --- | --- | --- | --- | --- |
| `sprites/planet.png` | 160 x 160 | 1 | `sprites/planet` | The warm banded planet: disc exactly 140 px across centered on the canvas; the 10 px margin carries the translucent atmosphere limb (real alpha — it composites over the starfield). Drawn centered on the stage center. |
| `sprites/pods/{widen,narrow,multiball,shield,pierce}.png` | 24 x 24 | 5 | `sprites/pods/<kind>` | One per pod kind, pairwise tellable apart in flight by hue + silhouette + glyph: widen = ice-cyan wide capsule, outward arrows; narrow = ember tall capsule, inward arrows; multiball = gold round pod, three balls; shield = green hex pod, ring; pierce = violet diamond, down-lance. The HUD may reuse them as active-effect indicators. |
| `sprites/ball/{0..5}.png` | 24 x 24 | 6 | `sprites/ball/<frame>` | ONE tumbling debris chunk (the ball is 16 px across), drawn once and rotated 60 degrees per frame via a `draw-sheet` layer keyframe, so 0→5 wraps into a seamless full turn. Played 0..5 in order, one frame per 5 simulation ticks, each ball's phase counted from its spawn tick. |

## Particle systems — `scripts/gen-fx.sh`

Each is a simulated `system.json` played live through
`@test-cabinet/particle-runtime`'s `./canvas` binding on the same context the field is
drawn into; every play varies. All three are authored **radially symmetric** (centered
point/disc emitters, 360-degree cones, no gravity, no wind) on a neutral 128 x 128
field, so an instance reads correctly at any bearing around the planet; placing and
scaling an instance at its event's position is the build's code.

| File | Field | Loader key | Fired at |
| --- | --- | --- | --- |
| `particles/burst.json` | 128 x 128, one-shot, 700 ms | `particles/burst` | The arc center of a destroyed target: white-hot flash blooming cyan, an expanding shockwave shell, tumbling steel debris cooling to dark metal. |
| `particles/spark.json` | 128 x 128, one-shot, 380 ms | `particles/spark` | The contact point of a paddle, containment, or shield reflection: a cold pin-flash and fast glassy slivers. Cheap — it fires constantly. |
| `particles/burnup.json` | 128 x 128, one-shot, 900 ms | `particles/burnup` | A ball or pod reaching the planet: the one WARM effect — an amber flare with a rotationally-symmetric ember swirl and lingering ash, in the planet's own palette. |

## Audio — `scripts/gen-audio.sh`

44.1 kHz PCM-16 throughout; decoded with the Web Audio API. Cues are pure `sfx-synth`
(the cold/glassy palette wants tight oscillator control; no sample pack needed). The
beds are `music` over **synth-waveform tracks** (`sine`/`triangle`/`saw`/`square` —
the contract allows the bank, synth waveforms, or both). Each `.wav`'s loader key is
its cue name; the beds keep their `.mid` beside the `.wav` (optional per the contract,
kept as the portable score).

| File | Length | Ch | Cue / bed | Character |
| --- | --- | --- | --- | --- |
| `audio/paddle-bounce.wav` | 0.12 s | mono | paddle bounce | glassy triangle pop snapping up a fifth |
| `audio/field-bounce.wav` | 0.30 s | stereo | containment reflection | deep sine thud + electric hum — energy, not metal |
| `audio/target-hit.wav` | 0.18 s | mono | non-destroying hit | dull FM/ringmod dead-metal clank |
| `audio/target-break.wav` | 0.80 s | stereo | destruction | the clank grown into a glass shatter + debris tail — reads over a busy field |
| `audio/shield-reflect.wav` | 0.34 s | stereo | shield consumed | saw zap diving down, glass shard flying up |
| `audio/pod-catch.wav` | 0.36 s | stereo | catching widen/multiball/shield/pierce | bright two-note UP (E5→A5) |
| `audio/pod-catch-narrow.wav` | 0.43 s | stereo | catching narrow | sour detuned two-note DOWN (A4→Eb4) — bad news by ear alone |
| `audio/pod-burn.wav` | 0.55 s | mono | pod burn-up | small fizz falling away |
| `audio/ball-lost.wav` | 0.74 s | stereo | ball burn-up | whoosh diving into a low thud |
| `audio/wave-clear.wav` | 1.08 s | stereo | the clearing event | cold ascending glass arpeggio |
| `audio/game-over.wav` | 3.40 s | stereo | entering gameover | the HEAVIEST sound: a two-octave saw collapse over a sub drone — clearly longer and lower than every cue; rings out over silence |
| `audio/menu-move.wav` | 0.06 s | mono | menu navigation | tiny glass tick |
| `audio/menu-select.wav` | 0.24 s | mono | menu confirm | short two-tone affirm |
| `audio/music-title.wav` (+ `.mid`) | 16.000 s | stereo | title + howto bed | drifting open-fifth A-minor pad, sparse falling glass bells — 4 bars at 60 BPM filling the file exactly, so the loop seam lands on a bar line |
| `audio/music-play.wav` (+ `.mid`) | 20.000 s | stereo | playing + waveclear + paused bed | pulsing triangle bass under open-fifth pads, cold square glints, a bar-line low kick — 8 bars at 96 BPM filling the file exactly |

Both beds loop seamlessly by construction: the note grid fills `max_duration_ms`
exactly, the end-of-file sample level matches an ordinary internal bar line, and each
sits under the cues (bed peaks ~0.24 vs cue peaks 0.3–0.9).

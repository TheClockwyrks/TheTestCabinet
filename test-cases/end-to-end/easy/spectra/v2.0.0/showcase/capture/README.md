# Showcase capture drivers

`<variant>.showcase-capture.test.ts` (re)records the three files in
`showcase/<variant>/` from that variant's **engineless** reference
implementation, playing a real run: the title menu is confirmed into a run, and
the resonator-fighter is then flown with scripted keyboard input against the
game's own rules, several takes are auditioned, and the most watchable one is
replayed under the recorder. Nothing is posed once play has begun — the only
debug call either driver makes is `reset`, before the run opens, so that a take
can be auditioned recorder-off and then re-run recorder-on identically.

## Why `references/none`

All three references play the same game, but only the engineless project runs in
a real browser, where a sprite is a real `ImageBitmap` the recorder captures into
the recording's image table. The two engine-backed projects render headless over
`@napi-rs/canvas`, whose decoded images the recorder cannot carry, so their
recordings name every `drawImage` source as an opaque handle and come back with
an **empty** image table — the committed `validation-baseline/simple-2d/` and
`validation-baseline/structured-2d/` replays all carry `images: []`, against ten
bitmaps in the `none` ones. That is fine for a validator's evidence, which is
read beside a baseline drawn exactly the same way, and wrong for a showcase.
Spectra draws its ship and all three drone kinds from the seeded sprite art, so
an engine-backed capture would show a visitor a starfield with the ship and the
swarm missing.

This is the one point at which the stage departs from the design plan
(`/home/ttc/ttc-plans/spectra.md` §5), which named `references/simple-2d`.
Wireworm v2.0.0 reached the same conclusion for the same reason.

## Running one

Stage the validator project into the reference workspace, lift the two frame caps
that exist to keep a validator's evidence small, and drop the driver in as a
test:

```sh
cd references/none/<variant>
npm ci && npm run build           # the suite serves dist/ to Chromium
cp -r ../../../validation/none validation
cp ../../../showcase/capture/<variant>.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
python3 - <<'PY'
# The written replay's cap, so a clip of this length is written at a usable rate.
p = "validation/harness.ts"
s = open(p).read()
open(p, "w").write(
    s.replace(
        "const MAX_REPLAY_FRAMES = 300;",
        'const MAX_REPLAY_FRAMES = Number(\n'
        '  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\n);',
    )
)
# The in-page recorder's own cap, which decimates while it captures. Left at 600
# a half-minute capture comes back at twenty frames a second whatever the written
# cap says.
p = "validation/recorder-init.js"
s = open(p).read()
open(p, "w").write(s.replace("const KEEP_MAX = 600;", "const KEEP_MAX = 3000;"))
PY
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=900 \
  TCAB_SHOWCASE_MIN_SECONDS=28 TCAB_SHOWCASE_MAX_SECONDS=38 \
  TCAB_SHOWCASE_SEEDS=1,2,3,5,7,11,13,17 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

Neither patch touches the committed validators: `validation/none/` keeps both
caps as they are, and the staged copy is deleted afterwards. The outputs land
under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`; copy
`gameplay.json.gz`, `mid-wave.png` and `title.png` into `showcase/<variant>/`,
then remove the staged `validation/` directory from the reference workspace.

## The knobs

| Variable                                                  | What it does                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`                               | Where the outputs are written. Unset, the driver plays and reports but writes nothing, which is how an audition is run.             |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES`                         | The staged harness's replay cap. See _The frame rate and the weight_ below for why the committed clips were written at `900`.       |
| `TCAB_SHOWCASE_MIN_SECONDS` / `TCAB_SHOWCASE_MAX_SECONDS` | The bounds a take is played between. It ends on the first settled beat past the minimum, and is cut at the maximum if none arrives. |
| `TCAB_SHOWCASE_SEEDS` / `TCAB_SHOWCASE_PHASES`            | The seeds and pilot phases auditioned, comma-separated. Every seed is played at every phase.                                        |
| `TCAB_SHOWCASE_SEED` / `TCAB_SHOWCASE_PHASE`              | Skip the audition and record exactly this take. How a committed clip is reproduced.                                                 |
| `TCAB_SHOWCASE_QA_STILLS`                                 | `1` writes a still every three seconds of the recorded take, for eyeballing it.                                                     |

A take's `phase` varies it beyond what the seed does: how long the pilot commits
to an aim before re-reading the field, and how much better the other band's field
has to look before it spends a flip on re-tuning to hunt it.

## How a take is judged

The capture is deterministic: the same seed and phase replay the identical run.
A take is rated on what makes a watchable clip rather than on anything the
validators care about — matched kills, bullets absorbed on the hull, flips spent,
dives launched at the ship, Prism shells broken and cores destroyed, spectral
inversions, discharges and how much each took off the field, stages cleared, the
longest stretch in which nothing happened, deaths, and whether it reached a
settled beat to end on rather than running out of time.

The rating is a **rate**, restated over a thirty-second clip, rather than a
total. A replay's weight is set by the frames it keeps, not by the seconds it
covers, so of two takes carrying the same play the shorter one is the better
clip: it holds the same action at a higher frame rate for the same number of
bytes.

The overload driver adds the charge model to that: charges laid, overloads
triggered, and a large bonus for a take carrying **one of each** reaction — a
Shard plunging, a Flux flipping and spraying, a Prism bursting — because three
kinds answering an overload differently is what that mode is. A take with five
plunges shows a third of the rule five times.

## The frame rate and the weight

Spectra's guidance bounds pull against each other on this build, and the
committed clips sit at the compromise. The two references pop every destroyed
drone with the seeded `drone-burst` particle system, and the particle runtime
draws each particle through a radial gradient created for that particle on that
frame. A recorded frame of live play therefore carries about fifteen hundred
operations and sixty gradients, against wireworm's low hundreds — the case's own
`validation-baseline/none/` replays run about 2.5 KB gzipped per frame, and a
showcase clip of a wave being cleared runs about 3.7 KB.

Written whole, a half-minute clip at 60 fps is therefore around 6.5 MB, which is
a slow preview stage. `thinReplay` keeps every *n*th frame, so the choices are
quantized by the stride: stride 2 gives 30 fps at about 3 MB, stride 3 gives 20
fps at about 2 MB. Both committed clips were written at `900`, which is stride 2
— 30 fps, and 3.4 MB and 2.4 MB. Smoothness was preferred to the last megabyte;
both are far inside the 25 MiB per-file cap.

## What is committed

Twenty-four takes were auditioned for each variant, eight seeds at three pilot
phases each, with `TCAB_SHOWCASE_MIN_SECONDS=28` and
`TCAB_SHOWCASE_MAX_SECONDS=38`.

### `showcase/base/`

The winner was **seed 17, pilot phase 1**, from `references/none/base`:

- `gameplay.json.gz` — 883 frames spanning 29.4 s, thinned from 60 Hz to 30 fps.
  Stage 1 flown to a clear and stage 2 opened: 28 drones destroyed on matched
  shots, 4 enemy bullets absorbed on the hull, 12 flips, 10 dives launched at the
  ship, both Prisms broken shell-then-core, one spectral inversion, and a full
  resonance meter spent on a discharge. Three lives kept, 5150 points. It ends on
  the field standing quiet after the shooting.
- `mid-wave.png` — the fullest frame of the assembled block, which fell during
  the spectral inversion: both bands slotted overhead, a shot climbing, an enemy
  bullet coming down, the ship under it.
- `title.png` — the title screen the take opened on, taken after the recorder
  closed by resetting to the same seed.

### `showcase/overload/`

The winner was **seed 3, pilot phase 1**, from `references/none/overload`:

- `gameplay.json.gz` — 846 frames spanning 28.2 s, thinned from 60 Hz to 30 fps.
  Stage 1 flown to a clear: 29 drones destroyed, 7 bullets absorbed, 8 flips,
  both Prisms broken shell-then-core, 11 charges laid by wrong-band shots paying
  out **three overloads, one of each kind** — a Shard plunging, a Flux flipping
  and spraying, a Prism bursting — and a discharge that took six things off the
  field at once. Three lives kept, 5630 points.
- `mid-wave.png` — the frame carrying the most charge on the board: the block
  overhead with the telegraph standing on several drones.
- `title.png` — the OVERLOAD title screen, taken the same way.

## Reproducing them

```sh
# base, from references/none/base
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=900 \
  TCAB_SHOWCASE_MIN_SECONDS=28 TCAB_SHOWCASE_MAX_SECONDS=38 \
  TCAB_SHOWCASE_SEED=17 TCAB_SHOWCASE_PHASE=1 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts

# overload, from references/none/overload
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=900 \
  TCAB_SHOWCASE_MIN_SECONDS=28 TCAB_SHOWCASE_MAX_SECONDS=38 \
  TCAB_SHOWCASE_SEED=3 TCAB_SHOWCASE_PHASE=1 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

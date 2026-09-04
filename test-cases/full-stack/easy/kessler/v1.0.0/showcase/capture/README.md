# Showcase capture driver

`base.showcase-capture.test.ts` (re)records everything in `showcase/base/` — the
`gameplay.json.gz` replay and its three `.png` stills — from
`references/structured-2d/base`, playing a REAL orbital demolition run. The
title stands for a beat and START is taken with a real `confirm` key press;
from there the deflector is ridden round its track on held `ArrowLeft` and
`ArrowRight`, the ball is served with `Space`, and every bounce, break, salvage
pod and effect on screen is the game resolving its own rules under that input.
Nothing is posed mid-play.

The take is one continuous stretch of wave 1: the serve out through all three
rings, a rally of steered bounces that opens holes in the derelict rings, the
salvage pods those breaks shed falling radially inward, the deflector leaving
the ball to go and catch them, and the effects a catch grants — `multiball`
putting up to six balls in the sky at once, `widen` stretching the deflector's
span, `pierce` sending a ball straight through whatever it meets, and `shield`
raising a ring round the planet that buys one miss back. It ends on the settled
beat after a break or a catch, never mid-flight.

## Planning through the game's own rules

The driver has two layers, and only the lower one touches the game.

EXECUTION is the keyboard: a rotation key is held down while the deflector is
short of where it wants to be and released when it arrives, so the deflector
turns at the `270` degrees per second `specs/deflector-and-ball.md` gives it and
either gets there in time or does not.

PLANNING never relaxes the game to make that easier. It imports the build's own
exported motion and reflection — `paddleBounce` and `surfaceReflect` from
`src/reflect.ts`, the arc geometry from `src/rings.ts`, the wave figures from
`src/figures.ts` — and replays candidate futures through them over a copy of the
state read off `snapshot()`:

- Where each ball in flight will next fall through the deflector's contact
  radius of `194`, found by stepping it forward under the specified straight-line
  motion, the ring orbits, the target contacts with their ring kick, and the
  containment field, exactly as `specs/field.md` orders a tick. The deflector is
  deliberately absent from that model: what the planner wants is the angle the
  ball will cross at, so that the deflector can be standing there.
- Which offset to meet it at. The bounce's english turns the return by `1.2`
  degrees per degree of offset, so where on the deflector the ball lands decides
  where it goes — the case's headline mechanic. Each offset the deflector can
  actually ride to in time is put through `paddleBounce` and the return is
  played forward through the same rules; the offset whose return breaks the most
  is the one taken.
- Which salvage pods are worth a detour. A pod falls radially at a constant
  speed with its angle held, so each is an appointment — an angle, and the tick
  it reaches the catch radius of `196`. One is taken when the detour still
  leaves the track needed to be back under the ball, and `narrow` pods are left
  alone, as a player would leave them.

## What the driver may touch

Two debug operations, and no others:

- `reset(seed)`, called BEFORE the take begins, which lays the pod generator
  with the seed. Choosing the seed is what lets a take be auditioned at all.
- `snapshot()`, a reading that changes nothing.

There is no `setScreen`, no `spawnBall`, no `setPaddleAngle`, no `spawnPod`, no
`setScore`, no `setEffectTicks`, no driver switch. The clock is the harness's
own `ConstantClock` of one tick a frame, which is what `specs/instrumentation.md`
says a scenario pairs with `engine.advance`. The deflector turns because a key
is down, the ball leaves because `Space` was struck, every derelict that breaks
was hit by a ball the player put there, and every pod is one the seeded draw
shed.

## Running it

Never stage into a reference directory: `tcab capture-baselines` runs `npm ci`,
`npm run build` and the whole validator project IN PLACE there, and a concurrent
stage is destroyed by it. Take a private copy instead.

The copy has to sit at the SAME DEPTH below the repository root as the reference
does, because the reference's `package.json` names the vendored engine and
particle runtime by relative `file:` paths (`file:../../../../../../../../packages/...`).
Eight path segments below the root is what those resolve against, and the
staging path below is exactly that.

```sh
REPO=$PWD                                        # the repository root
V=$REPO/test-cases/full-stack/easy/kessler/v1.0.0
REF=$V/references/structured-2d/base
WORK=$REPO/tmp/stage/showcase-capture/kessler/v1.0.0/references/structured-2d/base

# The vendored packages are built from source, so build them before installing.
npm run build -w @test-cabinet/structured-2d -w @test-cabinet/particle-runtime

mkdir -p "$WORK"
for item in .prettierrc.json .prettierignore .gitignore src assets public \
  scripts index.html package.json package-lock.json tsconfig.json \
  vite.config.ts vitest.config.ts eslint.config.js; do
  cp -r "$REF/$item" "$WORK/"
done
(cd "$WORK" && npm ci)

cp -r "$V/validation/structured-2d" "$WORK/validation"
cp "$V/showcase/capture/base.showcase-capture.test.ts" \
  "$WORK/validation/base.showcase-capture.test.ts"

# Let the capture keep more frames than the validators' 300-frame replay cap.
perl -0pi -e 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",
);/m' "$WORK/validation/harness.ts"

cd "$WORK"
TCAB_VALIDATION_MEDIA_DIR="$REPO/tmp/out" \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1000 \
  TCAB_SHOWCASE_TAKES=24 \
  npx vitest run --config validation/vitest.config.ts \
  validation/base.showcase-capture.test.ts
```

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/base.showcase-capture.test.ts/`,
four files per take, and the last line of the log names the winner. Copy that
take's four files into `showcase/base/`:

| Take file | Committed as | What it shows |
| --- | --- | --- |
| `take-NN.json.gz` | `gameplay.json.gz` | The run. |
| `take-NN-field.png` | `full-rings.png` | The board at the top of the run: three intact rings, the planet, the deflector, the ball outbound. |
| `take-NN-breakout.png` | `mid-demolition.png` | The rings gutted, six balls in the sky, pods falling, the shield up and two timed effects running. |
| `take-NN-salvage.png` | `salvage-inbound.png` | A salvage pod on the last of its fall, inside the deflector's span. |

Nothing is left behind under `references/`: the whole stage lives in `tmp/`,
which is gitignored, and `rm -rf "$REPO/tmp/stage"` disposes of it. Confirm it
with `git status` before committing.

## Auditioning

The take is deterministic: the same seed replays the identical run, which is
what lets a take be judged with the recorder off and then re-run with it on.
EVERY TAKE IS RECORDED AS IT IS PLAYED anyway, so the take that was judged is
provably the take that was committed and the winner never has to be replayed —
which is the expensive half of doing it the other way. Each take also gets its
own engine: a run replayed over a world that has already run inherits its frame
counter, the key edges the last take left armed, and whatever the last render
left on the canvas.

Each take prints what it did — balls served and lost, deflector bounces, hits
and derelicts destroyed, pods shed, caught, burned and which kinds were caught,
the most balls in the sky at once, points, the wave reached and the waves
cleared, lives left, the longest stretch with nothing happening, and whether it
ended on a settled beat or ran out. The judge weighs those the way a preview is
watched: breaks and CAUGHT pods rather than merely shed ones, the variety of
effects a catch put on screen, extra balls in the sky, waves cleared, and a
clean ending — against lives thrown away, a run that died, and a long lull,
which is the one thing a preview stage cannot afford.

## The knobs

| Variable | Default | What it does |
| --- | --- | --- |
| `TCAB_VALIDATION_MEDIA_DIR` | unset | Where the media is written. Nothing is written without it, and the driver still plays every take. |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300` | The harness's written-replay cap, patched above to read it. At `1000` a take of this length is thinned by exactly two, to 30 fps; see the weight note below. |
| `TCAB_SHOWCASE_TAKES` | `8` | How many seeds to play and judge. |
| `TCAB_SHOWCASE_FIRST_SEED` | `1` | The first seed of that run of takes. |
| `TCAB_SHOWCASE_MIN_SECONDS` | `23` | The clip ends at the first settled beat past this. |
| `TCAB_SHOWCASE_MAX_SECONDS` | `29` | The take is abandoned here, wherever it had got to. |

## What shipped

Twenty-four takes were played and judged, from seed `1`, at the default bounds
and a `1000`-frame cap. The committed take is **seed 22**, the clear winner at
1042 against a field whose next best scored 823:

| | |
| --- | --- |
| Length | 24.4 s, 732 frames at 30 fps |
| Play | 1 ball served, 26 deflector bounces, 50 target hits |
| Demolition | 40 of the wave's 48 derelicts broken |
| Salvage | 16 pods shed, 10 caught, 6 burned up |
| Effects seen | `multiball`, `widen`, `pierce` and `shield`, all four caught |
| Traffic | up to 6 balls in the sky at once |
| Score | 9,350 points, wave 1, all 3 lives intact |
| Pace | longest stretch with nothing happening: 1.1 s |
| Ending | settled, on the beat after a break, with 8 derelicts standing |

NO TAKE CLEARED A WAVE, and none was expected to. A wave is 48 derelicts and
64 hits, and the driver lands 50 in the twenty-four seconds a preview can
afford. Played out to seventy-five seconds, the best seed still had one derelict
standing: with the rings nearly empty the planner's aim search finds no offset
whose return breaks anything, so the endgame degenerates into a hunt. A driver
that meant to record a clearing event would need a tiebreak that steers toward
the nearest live arc when no offset breaks one — and a clip well past forty
seconds to hold the result.

## The produced sprites, and why they are in the replay

The engine's recorder captures a drawn bitmap's pixels into the replay by
asking whether the value is an instance of one of the host's own image classes.
The validator harness names `@napi-rs/canvas`'s `Image` as this host's
`ImageBitmap` when it stands the host's assets up, which is what its
`createImageBitmap` hands back anyway, so the driver needs nothing of its own
and the replay carries the produced art: the planet, the five pod sprites, and
the ball's six spin frames. Check it after a capture — `images` should be
non-empty and no `drawImage` should carry a `$opaque` argument.

## What the media weighs, and why the clip is thinned

Kessler draws a lot per frame. A frame of the live field issues on the order of
1,600 canvas operations: a hundred and fifty background stars, each with its own
`globalAlpha` recomputed every tick for the twinkle, plus three rings of up to
forty-eight derelicts with their damage cracks, the planet, the deflector, the
balls, the pods, the containment field, the HUD and whatever particle systems
are running. The recorder interns identical operations, but a star's alpha is a
different number every frame, so a hundred and fifty operations per frame never
dedupe — the operation table of an unthinned take runs to about 305,000 entries
and the file to about 4.5 MB.

At the replay cap of `1000` the harness thins by exactly two, which halves the
operation table with it: the committed clip is 30 fps and 2.18 MB, in line
with the heavier replays this repository already ships and lighter than three
of them. That is the trade the guide's two bounds — near 60 fps, and a megabyte
or two a file — cannot both have on this case, and the preview stage's load
time is the one that was preferred. The thinning is uniform and the per-frame
deltas are recomputed with it, so the clip still plays back in real time.

The three stills are `1000 x 1000` PNGs of the frame the harness had on its
canvas: `full-rings.png` is 368 kB, `salvage-inbound.png` 311 kB, and
`mid-demolition.png` 288 kB — the emptier the rings, the smaller the picture.
`showcase/base/` therefore weighs about 3.1 MB in all.

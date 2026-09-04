# Showcase capture drivers

`base.showcase-capture.test.ts` (re)records `showcase/base/`'s three media files
from the reference implementation, playing a REAL Containment run: the title
menus are walked with key input, the floor is built on with the pointer, each
wave is sent early from the panel's own SEND control, and the wave is then
fought by the build's own rules. Several takes are auditioned by seed and the
most watchable one is replayed under the engine's recorder. Nothing is posed
mid-play — the only debug call the driver makes is `reset(seed)`, before the
take begins, because the vent each unit enters at is the game's only randomness
and a seed is what makes a take reproducible.

The driver's header comment describes the take beat by beat.

## Running it

Stage the validator project into the `structured-2d` reference workspace, drop
the driver in as a test, and let the capture keep more frames than the
validators' 300-frame replay cap:

```sh
cd references/structured-2d
cp -r ../../validation/structured-2d validation
cp ../../showcase/capture/base.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
sed -i 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(\
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\
);/' validation/harness.ts
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2600 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`; copy
`gameplay.json.gz`, `mid-wave.png` and `inspector.png` into `showcase/base/`,
then delete the staged `validation/` copy. Nothing about the staging is
permanent: `validation/structured-2d/harness.ts` keeps its 300-frame cap, which
is the right cap for a validator's evidence and far too short for a clip of this
length.

## The knobs

| Variable                          | What it does                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| `TCAB_SHOWCASE_SEEDS`             | The seeds auditioned, comma separated. Default `1,2,3,4,5,6`. |
| `TCAB_SHOWCASE_MAX_SECONDS`       | The ceiling on a take's game time. Default `48`.              |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | The staged harness's replay cap (see above).                  |

## What was committed

`showcase/base/gameplay.json.gz`, `mid-wave.png` and `inspector.png` were
captured from `references/structured-2d` by exactly the command above — the
default `1,2,3,4,5,6` audition, a `2600`-frame cap — which picked **seed 6**.
That take ran 36.4 s of game time on the suite's 120 Hz clock, and the thinner
kept every second frame: 2187 frames at exactly 60 fps, 414 KiB gzipped. It
cleared Waves 1 and 2 with no leak, tripped four guns, dropped the Sink against
the first one to go, and finished on 20 towers with the next wave's card up on
the panel.

Re-running that command reproduces all three files byte for byte. Change the
audition, though, and the replay's bytes change even when the same seed wins:
the recorder stamps each frame with the engine's own absolute frame count and
clock, which have run further by the time a longer audition reaches the take.
The pictures are unaffected, and so is what the replay shows — but if the
committed `gameplay.json.gz` is to be reproduced rather than merely re-captured,
run the audition as it is written above.

## Judging a take

The audition scores each take on what makes a watchable clip rather than on
whether it won: units killed, waves cleared, a gun tripping at all, the Sink
going in, how many towers ended up on the floor, and against it the leaks and
the widest stretch with nothing happening. `report()` prints the line for every
take, so a re-run can be eyeballed before its winner is kept.

`TCAB_SHOWCASE_QA_STILLS=1` is not wired up here; to eyeball a take frame by
frame, add a `captureStill(p.h, ...)` on a frame count inside `fightWave` and
run with a media directory set.

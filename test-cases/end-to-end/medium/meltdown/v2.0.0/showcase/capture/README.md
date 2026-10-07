# Showcase capture drivers

`base.showcase-capture.test.ts` (re)records `showcase/base/`'s three media files
from the reference implementation, playing a REAL Containment run: the title
menus are walked with key input, the floor is built on with the pointer, each
wave is sent early from the panel's own SEND control, and the wave is then
fought by the build's own rules. Several takes are auditioned, each recorded
under the engine's recorder as it plays, and the driver names the most watchable
one at the end. Nothing is posed mid-play — the only debug call the driver makes
is `reset()`, before the take begins. The vent each unit enters at is the game's
own draw, which is why every take is recorded rather than replayed: a take
cannot be played again.

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
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`, one set
per take as `take-N-gameplay.json.gz`, `take-N-mid-wave.png` and
`take-N-inspector.png`; the driver's last line names the best take. Copy that
take's three files into `showcase/base/` as `gameplay.json.gz`, `mid-wave.png`
and `inspector.png`, then delete the staged `validation/` copy. Nothing about
the staging is permanent: `validation/structured-2d/harness.ts` keeps its
300-frame cap, which is the right cap for a validator's evidence and far too
short for a clip of this length.

## The knobs

| Variable                          | What it does                                     |
| --------------------------------- | ------------------------------------------------ |
| `TCAB_SHOWCASE_TAKES`             | How many takes are auditioned. Default `6`.      |
| `TCAB_SHOWCASE_MAX_SECONDS`       | The ceiling on a take's game time. Default `48`. |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | The staged harness's replay cap (see above).     |

## What was committed

`showcase/base/gameplay.json.gz`, `mid-wave.png` and `inspector.png` were
captured from `references/structured-2d` by the command above: a six-take
audition at a `2600`-frame cap, of which the best take was kept. That take ran
36.4 s of game time on the suite's 120 Hz clock, and the thinner kept every
second frame: 2187 frames at exactly 60 fps, 414 KiB gzipped. It cleared Waves 1
and 2 with no leak, tripped four guns, dropped the Sink against the first one to
go, and finished on 20 towers with the next wave's card up on the panel.

Re-running the command records a fresh audition. The vent each unit enters at is
the game's own draw, so no two auditions play the same takes, and the committed
files are re-captured, never repeated: judge the new best take against the
description above before replacing them.

## Judging a take

The audition scores each take on what makes a watchable clip rather than on
whether it won: units killed, waves cleared, a gun tripping at all, the Sink
going in, how many towers ended up on the floor, and against it the leaks and
the widest stretch with nothing happening. `report()` prints the line for every
take, so a re-run can be eyeballed before its winner is kept.

`TCAB_SHOWCASE_QA_STILLS=1` is not wired up here; to eyeball a take frame by
frame, add a `captureStill(p.h, ...)` on a frame count inside `fightWave` and
run with a media directory set.

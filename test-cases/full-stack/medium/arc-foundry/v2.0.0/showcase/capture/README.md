# Showcase capture drivers

The driver here (re)records the `base` variant's `showcase/base/gameplay.json.gz`
replay and its two stills from the reference implementation, playing a REAL
session: the title menu is walked with pointer presses, the press is pulled, the
five rocks a level allows are dropped on footprints the game reports legal, the
inspector is read and whichever fold or KEEP it offers is pressed to send the
wave, the speed control is pushed up while the Load crosses, and the wave's
bounty is spent refining the press. The only debug operations it calls are the
three readings — `snapshot()`, `panelButtons()` and `statusControls()` — so
every roll, kill, leak and clear on screen is the simulation's own.

To run it, stage the validator project into the reference workspace and drop the
driver in as a test:

```sh
cd references/structured-2d
cp -r ../../validation/structured-2d validation
cp ../../showcase/capture/base.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# Let the capture keep more frames than the validators' 300-frame replay cap:
sed -i 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(\
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\
);/' validation/harness.ts
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1700 \
  TCAB_SHOWCASE_TAKES=10 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
rm -rf validation
```

The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`, three files
per take, and the last line of the log names the winner and what each of its
files is committed as:

| Take file           | Committed as                     |
| ------------------- | -------------------------------- |
| `take-NN.json.gz`   | `showcase/base/gameplay.json.gz` |
| `take-NN-wave.png`  | `showcase/base/mid-wave.png`     |
| `take-NN-build.png` | `showcase/base/build-phase.png`  |

## Why every take is recorded

Confirming a difficulty is what starts a run, and the game reseeds its press
there on purpose, so that two runs started from the menu never draw the same
rolls.
A take driven the way a player drives one therefore cannot be played silently,
judged, and then replayed identically under the recorder — the second playing is
a different session. So the driver records every take as it plays it and judges
what it actually produced: waves cleared, recipe folds committed, plain folds,
kills landed, structures standing, refinement reached, Grid Integrity held, and
whether it ended on the settled beat a wave clear gives. The take that was judged
is the take that is committed.

Each take also gets its own engine. A session replayed over a world that has
already run inherits its frame counter, its pointer, the effects still playing,
and whatever input edges the last take left armed.

## The knobs

| Variable                          | Default | What it does                                                                                                                    |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300`   | The harness's replay cap, patched above to read it. At `1700` a take of this length is kept whole, at 60 fps, with no thinning. |
| `TCAB_SHOWCASE_TAKES`             | `8`     | How many takes to play and judge.                                                                                               |
| `TCAB_SHOWCASE_MIN_SECONDS`       | `20`    | The clip ends at the first wave clear past this.                                                                                |
| `TCAB_SHOWCASE_MAX_SECONDS`       | `27`    | The take is abandoned here; no level is opened with less than six seconds left of it.                                           |
| `TCAB_SHOWCASE_WAVE_SPEED`        | `4`     | The speed rung the player pushes to once the Load is crossing.                                                                  |

The Substation's chain is a lap of the whole yard, so a Mote spends the better
part of a minute walking it: the speed control is what keeps a clip watchable,
and `4` is the rung that leaves the Load readable while still fitting several
levels into half a minute.

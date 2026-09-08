# Showcase capture drivers

The driver here (re)records the `base` variant's `showcase/base/crossing.json.gz`
replay and its two stills from the `structured-2d` reference implementation,
playing a REAL run: the title screen is confirmed with a key, and the critter is
then driven across the strait with real held-key input while the game's own rules
decide everything else. Nothing is posed mid-play — the four world gates stay on,
so bears emerge on the run's own conditions, the catch costs a life, the crossing
timer drains and the bonus catch comes and goes exactly as they do for a player.

The scripted crosser plans through what the game publishes about itself rather
than through anything private. A lane keeps its items exactly one period apart on
a ring forever (`specs/ice.md`, `specs/water.md`), so the whole future of a lane
is recovered from one snapshot of it: the period is the spacing of its items and
coverage at a future moment is that pattern slid by `dir * speed * TILE * t`. The
player hops on the gaps that arithmetic finds, steers for an open bay once it is
out on the water, and gets caught, crushed or drowned when it misjudges one.

## Running it

Stage the validator project into the reference workspace and drop the driver in
as a test:

```sh
cd references/structured-2d
cp -r ../../validation/structured-2d validation
cp ../../showcase/capture/base.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# Let the capture keep more frames than the validators' 300-frame replay cap:
python3 - <<'PY'
p = "validation/harness.ts"
s = open(p).read()
s = s.replace(
    "const MAX_REPLAY_FRAMES = 300;",
    'const MAX_REPLAY_FRAMES = Number(\n'
    '  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\n'
    ");",
)
open(p, "w").write(s)
PY
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1650 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`;
copy `crossing.json.gz`, `mid-crossing.png` and `title.png` into `showcase/base/`,
then delete the staged `validation/` copy. The validators' own cap is left at
`300` — only the staged copy is patched, so no review item's replay grows.

## The knobs

| Variable                                                  | Effect                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`                               | Where the outputs are written. Unset, nothing is written and the audition only logs its scores.                                                                 |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES`                         | The staged harness's replay cap. `1650` holds a 27-second clip at 60 fps after thinning (a take is `120` frames a second, and the cap thins by a whole stride). |
| `TCAB_SHOWCASE_MIN_SECONDS` / `TCAB_SHOWCASE_MAX_SECONDS` | The clip's bounds, `22` and `30` by default. The take ends on the first bay filled past the minimum.                                                            |
| `TCAB_SHOWCASE_SETTLE_SECONDS`                            | How long the clip keeps rolling after that bay, `0.9` by default — the hold, and the fresh critter back on the near shore.                                      |
| `TCAB_SHOWCASE_TAKES`                                     | How many takes each of the five player styles is auditioned over, `5` by default.                                                                               |
| `TCAB_SHOWCASE_QA_STILLS`                                 | `1` writes a still every two seconds, for eyeballing a take.                                                                                                    |
| `TCAB_SHOWCASE_TRACE`                                     | `1` logs the critter's tile and footing twice a second, for tuning the player.                                                                                  |

## Auditioning

The strait a run opens on is the game's own draw, so no take can be played twice:
every candidate is recorded as it plays, as `take-<n>.json.gz` with its best
still as `take-<n>-mid-crossing.png`, and scored on what makes a watchable Floe
clip — bays filled, rows climbed, time spent out on the water, frames with a bear
within five tiles, the best mid-crossing still it offered, and against that its
deaths, its longest stretch without progress, and whether it stopped on the hold
after a bay rather than running out of clock. The winner's two files are renamed
to `crossing.json.gz` and `mid-crossing.png` and the other takes' files are
removed.

## What was committed

| File                             | How                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showcase/base/crossing.json.gz` | Cap `1650`, patience `0.34`, lean `+1`: 25.6 s, four bays filled, no lives lost, 451 frames with a bear inside five tiles, ended on the hold after the fourth bay. 1,537 frames after thinning — exactly 60 fps — and 1.4 MB. |
| `showcase/base/mid-crossing.png` | The best frame of that same take by the driver's own still score: the critter on the top water row on a floe, three bays filled, and a bear swimming a hundred units behind it.                                               |
| `showcase/base/title.png`        | The title screen, drawn by the same reference: the driver resets the game and runs one frame once the audition is over.                                                                                                       |

That take was chosen by auditioning eight takes of each of the five styles,
forty in all, and keeping the winner.

## One thing the driver does that a validator does not

It sets `globalThis.ImageBitmap` to `@napi-rs/canvas`'s `Image`. The harness
already stands `fetch` and `createImageBitmap` up over the workspace's own
`assets/` tree, so the sprites arrive and the stills are drawn with them; but the
engine's recorder keeps a `drawImage` source only when it recognizes the value as
a bitmap, and it recognizes one by testing it against the host's `ImageBitmap`.
Node defines no such global, so without this line every sprite records as an
opaque marker and the clip plays with the strait drawn and nothing on it. The
build is untouched — it asks the engine's loader for the same paths and draws the
same frames — and the committed clip renders with every operation resolved.
Fathom v3.0.0's capture drivers do the same thing for the same reason.

Note that the case's committed `validation-baseline/` replays are captured
WITHOUT this shim, by `tcab capture-baselines`, and so carry opaque markers where
their sprites would be. That is a property of the baseline pipeline rather than
of this driver, and it is not this directory's to change.

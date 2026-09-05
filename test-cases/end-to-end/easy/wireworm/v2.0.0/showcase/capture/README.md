# Showcase capture drivers

`base.showcase-capture.test.ts` (re)records the three files in
`showcase/base/` from the case's **engineless** reference implementation,
playing a real run: the title menu is walked into a descent, the defrag cursor
is then driven with scripted keyboard input against the game's own rules,
several takes are auditioned, and the most watchable one is replayed under the
recorder. Nothing is posed once play has begun.

## Why `references/none`

All three references play the same game, but only the engineless project runs
in a real browser, where a sprite is a real `ImageBitmap` the recorder captures
into the recording's image table. The two engine-backed projects render
headless over `@napi-rs/canvas`, whose decoded images the recorder cannot
carry, so their recordings name every `drawImage` source as an opaque handle.
That is fine for a validator's evidence, which is read beside a baseline drawn
exactly the same way, and wrong for a showcase, whose job is to show a visitor
the board as a player sees it.

## Running it

Stage the validator project into the reference workspace, lift the two frame
caps that exist to keep a validator's evidence small, and drop the driver in as
a test:

The shared harness comes with it: the runner stages
`@clockwyrks/case-harness` into a validator project as
`validation/case-harness/`, so a copy made by hand has to stage it too or
nothing in the project resolves. Both caps live in that package now rather than
in the case's own files, which is why the two patches below name paths under it.

```sh
cd references/none
npm ci && npm run build           # the suite serves dist/ to Chromium
cp -r ../../validation/none validation
cp -r ../../../../../../../packages/case-harness/src validation/case-harness
cp ../../showcase/capture/base.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
python3 - <<'PY'
# The written replay's cap, so a clip of this length is written whole.
p = "validation/case-harness/replay/format.ts"
s = open(p).read()
open(p, "w").write(
    s.replace(
        "export const MAX_REPLAY_FRAMES = 300;",
        'export const MAX_REPLAY_FRAMES = Number(\n'
        '  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\n);',
    )
)
# The in-page recorder's own cap, which decimates while it captures. Left at
# 600 a half-minute capture comes back at fifteen frames a second whatever the
# written cap says.
p = "validation/case-harness/page/recorder-init.js"
s = open(p).read()
open(p, "w").write(s.replace("const KEEP_MAX = 600;", "const KEEP_MAX = 3000;"))
PY
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2400 \
  TCAB_SHOWCASE_MIN_SECONDS=26 TCAB_SHOWCASE_MAX_SECONDS=36 \
  TCAB_SHOWCASE_SEEDS=1,2,3,4,5,6,7,8,9,11,13,17 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

Neither patch touches anything committed: the caps live in
`packages/case-harness/`, both patches are made to the COPY staged under
`validation/case-harness/`, and that whole staged tree is deleted afterwards.

The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`; copy
`gameplay.json.gz`, `mid-level.png` and `title.png` into `showcase/base/`, then
remove the staged `validation/` directory from the reference workspace.

## The knobs

| Variable                                                  | What it does                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`                               | Where the outputs are written. Unset, the driver plays and reports but writes nothing, which is how an audition is run.             |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES`                         | The staged shared harness's replay cap. 2400 holds forty seconds at 60 Hz without thinning.                                         |
| `TCAB_SHOWCASE_MIN_SECONDS` / `TCAB_SHOWCASE_MAX_SECONDS` | The bounds a take is played between. It ends on the first settled beat past the minimum, and is cut at the maximum if none arrives. |
| `TCAB_SHOWCASE_SEEDS`                                     | The seeds auditioned, comma-separated. Each is played at all three aim phases.                                                      |
| `TCAB_SHOWCASE_SEED` / `TCAB_SHOWCASE_PHASE`              | Skip the audition and record exactly this take. How the committed clip is reproduced.                                               |
| `TCAB_SHOWCASE_QA_STILLS`                                 | `1` writes a still every three seconds of the recorded take, for eyeballing it.                                                     |

## How a take is judged

The capture is deterministic: the same seed and phase replay the identical run,
which is what lets a take be auditioned with the recorder off and then re-run
under it exactly. A take is rated on what makes a watchable clip rather than on
anything the validators care about. Chain-arc discharges set off and how wide
they ran, segments fried and segments cut, levels cleared, lives kept, the
longest stretch in which nothing on the board changed, and whether it reached a
settled beat to end on rather than running out of time.

## What is committed

Thirty-six takes were auditioned, twelve seeds at three aim phases each, with
`TCAB_SHOWCASE_MIN_SECONDS=26` and `TCAB_SHOWCASE_MAX_SECONDS=36`. The winner
was **seed 13, aim phase 1**, recorded with `TCAB_SHOWCASE_MAX_REPLAY_FRAMES`
at `2400` and the in-page `KEEP_MAX` at `3000`:

- `gameplay.json.gz` — 1904 frames of a 60 Hz clock, 31.7 s, written whole at
  60 fps. Level 1 taken to a clear and level 2 played on into an eleven-node
  chain-arc discharge, 20 segments cut by bolts and one fried by the
  discharge, three lives kept, 1462 points. It ends 0.8 s after the discharge
  spent its arcs, on the board that was left.
- `mid-level.png` — the first live frame of level 2: its worm entering along
  row 0 over the field level 1 left behind.
- `title.png` — the title screen the take opened on, taken after the recorder
  closed by resetting to the same seed.

Reproduce all three with:

```sh
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2400 \
  TCAB_SHOWCASE_MIN_SECONDS=26 TCAB_SHOWCASE_MAX_SECONDS=36 \
  TCAB_SHOWCASE_SEED=13 TCAB_SHOWCASE_PHASE=1 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

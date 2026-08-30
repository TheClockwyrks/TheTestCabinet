# Showcase capture driver

`showcase-capture.test.ts` (re)records a variant's
`showcase/<variant>/gameplay.json.gz` replay and its two stills from that
variant's `structured-2d` reference implementation, playing a REAL round: the
title menu is left up for a beat and the mode entry is confirmed with a key
press, and from there the snake is steered with arrow presses along the route a
player would take — closing on the pellet while keeping enough open board behind
the head for the body that is coming. Nothing is posed.

One driver serves BOTH variants. It names no mode: the obstacle cells are read
off `snapshot()`, so the same routing threads Maze's course and crosses
Classic's open interior, and the two variants differ only in which reference the
driver is staged into.

## Running it

Never stage into a reference directory: `tcab capture-baselines` runs `npm ci`,
`npm run build` and the whole validator project IN PLACE there, and a
concurrent stage is destroyed by it. Take a private copy instead, and symlink
`node_modules` back so nothing is installed twice.

```sh
V=test-cases/full-stack/easy/coil/v2.0.0
REF=$PWD/$V/references/structured-2d/base       # or .../maze
WORK=$(mktemp -d)/coil-showcase

mkdir -p "$WORK"
for item in src assets public scripts index.html package.json \
  package-lock.json tsconfig.json vite.config.ts vitest.config.ts \
  eslint.config.js; do cp -r "$REF/$item" "$WORK/"; done
ln -s "$REF/node_modules" "$WORK/node_modules"
cp -r "$PWD/$V/validation/structured-2d" "$WORK/validation"
cp "$PWD/$V/showcase/capture/showcase-capture.test.ts" \
  "$WORK/validation/showcase-capture.test.ts"

# Let the capture keep more frames than the validators' 300-frame replay cap.
perl -0pi -e 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",
);/m' "$WORK/validation/harness.ts"

cd "$WORK"
TCAB_VALIDATION_MEDIA_DIR="$WORK/out" \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1900 \
  TCAB_SHOWCASE_TAKES=24 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`,
three files per take, and the last line of the log names the winner. Copy that
take's three files into `showcase/<variant>/`:

| Take file | Committed as (`base`) | Committed as (`maze`) |
| --- | --- | --- |
| `take-NN.json.gz` | `gameplay.json.gz` | `gameplay.json.gz` |
| `take-NN-peak.png` | `combo-peak.png` | `combo-peak.png` |
| `take-NN-early.png` | `open-board.png` | `threading-the-course.png` |

## Why every take is recorded

A seed fixes the whole round, so a take could be played silently, judged, and
replayed identically under the recorder. Every take is recorded as it is played
anyway, because that makes the take that was judged provably the take that was
committed — and replaying the winner is the expensive half of doing it the other
way. Each take also gets its own engine: a round replayed over a world that has
already run inherits its frame counter, the input edges the last take left
armed, and whatever the last render left on the canvas.

## What the driver may touch

Two debug operations, and no others:

- `reset({ seed })`, which chooses the seed the pellet generator is laid with.
  Choosing the session is what lets a take be auditioned at all.
- `snapshot()`, a reading that changes nothing.

Everything on screen is the game's own: the snake turns because an arrow key was
struck, every pellet is where the round's generator put it, every point is the
eat's, and the multiplier is whatever the window the game ran left standing.

## The sprites, and why the driver names `ImageBitmap`

The engine's recorder captures a drawn bitmap's pixels into the replay by asking
whether the value is an instance of one of the host's own image classes. Node
defines none of those names and the validator harness's `createImageBitmap`
hands back `@napi-rs/canvas`'s `Image`, so under the harness every sprite a
build blits records as `{ "$opaque": "Image" }` and a player skips it. Left
alone, the showcase's leading entry would be a Coil with no snake in it.

The driver therefore names that class as this host's `ImageBitmap` before it
makes a harness, which is what `createImageBitmap` returns here anyway. The
recorder then snaps each sprite once through its scratch canvas and the replay
carries the produced art: seven `32x32` bitmaps, a few hundred bytes each. The
fix lives in the driver and not in `validation/<engine>/harness.ts`, so every
committed validation baseline stays exactly as it was captured — a validator's
evidence clip is about a figure the harness read rather than about the picture,
and re-capturing the whole baseline set to change one is not worth it.

Check it after a capture: `images` should be non-empty and no `drawImage` should
carry a `$opaque` argument.

## The knobs

| Variable | Default | What it does |
| --- | --- | --- |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300` | The harness's replay cap, patched above to read it. At `1900` a take of this length is kept whole, at 64 fps, with no thinning. |
| `TCAB_SHOWCASE_TAKES` | `8` | How many seeds to play and judge. |
| `TCAB_SHOWCASE_FIRST_SEED` | `1` | The first seed of that run of takes. |
| `TCAB_SHOWCASE_MIN_SECONDS` | `22` | The clip ends at the first eat past this. |
| `TCAB_SHOWCASE_MAX_SECONDS` | `28` | The take is abandoned here, wherever it had got to. |

A take is judged on what makes a watchable clip of this game: pellets eaten, the
multiplier's peak, how many eats landed at that peak, whether the window was ever
LOST and rebuilt, points on the board, and a clean ending. The lost window
carries real weight — a clip that only ever shows the multiplier climbing shows
half the mechanic.

## What shipped

Both takes ran at `TCAB_SHOWCASE_TAKES=24` from seed `1`, at the default bounds
and a `1900`-frame cap, so both replays are whole and unthinned.

| Variant | Winning seed | What it plays |
| --- | --- | --- |
| `base` | 12 | 26.3 s, 13 pellets, 510 points, chain of 16, `x5` held over 8 eats, one window lost and rebuilt |
| `maze` | 23 | 26.3 s, 14 pellets, 560 points, chain of 17, `x5` held over 9 eats, one window lost and rebuilt |

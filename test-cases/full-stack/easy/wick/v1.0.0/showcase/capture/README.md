# Showcase capture driver

`showcase-capture.test.ts` (re)records `showcase/base/gameplay.json.gz` and its
two stills from the variant's `structured-2d` reference implementation, playing
a REAL stretch of the night: the lamp is lit with a key press on the title, the
lamplighter is walked with arrow presses along the route a player would take —
along the edge of the crowd, close enough for Taper to sweep it and far enough
not to be touched, over the gems the last kills left — and every level-up is
taken by walking the highlight down and pressing confirm. Nothing is posed.

## The clip opens two minutes in

Wick's first half-minute is one moth a second against one tool, and a clip of
it shows a mostly empty field. So the driver plays the night up to
`TCAB_SHOWCASE_LEAD_SECONDS` (`105`, a minute and three quarters) with the
recorder OFF and records from there: same steering, same offers, same keyboard,
one continuous night. What the clip opens on is a lamplighter carrying five
tools into bats, rats and beetles arriving every half second, with the night's
first elite due at `2:00`, which is the game the case is about.

The lead-in is where a take is lost. A night this player does not survive to
`LEAD_SECONDS` records nothing worth keeping, and the judge scores it far below
any take that did, so several seeds are auditioned and the survivors compete.

## Running it

Never stage into a reference directory: `tcab capture-baselines` runs `npm ci`,
`npm run build` and the whole validator project IN PLACE there, and a
concurrent stage is destroyed by it. Take a private copy instead, and symlink
`node_modules` back so nothing is installed twice.

```sh
V=test-cases/full-stack/easy/wick/v1.0.0
REF=$PWD/$V/references/structured-2d/base
WORK=$(mktemp -d)/wick-showcase

mkdir -p "$WORK"
for item in src assets public scripts index.html package.json \
  package-lock.json tsconfig.json vite.config.ts vitest.config.ts \
  eslint.config.js .prettierrc.json .prettierignore .vendor; do
  cp -r "$REF/$item" "$WORK/"
done
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
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2500 \
  TCAB_SHOWCASE_TAKES=10 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

Each take is a little over two minutes of simulation, so a run of ten takes is
a few minutes of wall clock. The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`, up to three
files per take, and the last line of the log names the winner. Copy that take's
files into `showcase/base/`:

| Take file             | Committed as                  |
| --------------------- | ----------------------------- |
| `take-NN.json.gz`     | `gameplay.json.gz`            |
| `take-NN-crowd.png`   | `the-crowd-closes-in.png`     |
| `take-NN-levelup.png` | `the-lamp-burns-brighter.png` |

## Why every take is recorded

A seed fixes the whole night, so a take could be played silently, judged, and
replayed identically under the recorder. Every take is recorded as it is played
anyway, because that makes the take that was judged provably the take that was
committed — and replaying the winner is the expensive half of doing it the
other way. Each take also gets its own engine: a night replayed over a world
that has already run inherits its frame counter, the input edges the last take
left armed, and whatever the last render left on the canvas.

## What the driver may touch

Two debug operations, and no others:

- `reset({ seed })`, which lays the generator every spawn, offer, and drop is
  drawn from. Choosing the seed is what lets a take be auditioned at all.
- `snapshot()`, a reading that changes nothing.

Everything on screen is the game's own: the lamplighter walks because an arrow
key is down, every enemy is where the director put it, every slash is Taper's
own timer coming due, every gem is a kill's, every offer is the pool's draw,
and the health bar is what the crowd left standing.

## The sprites, and where the `ImageBitmap` name comes from

The engine's recorder captures a drawn bitmap's pixels into the replay by
asking whether the value is an instance of one of the host's own image classes.
Node defines none of those names and the validator harness's
`createImageBitmap` hands back `@napi-rs/canvas`'s `Image`, so with nothing
named every sprite a build blits would record as `{ "$opaque": "Image" }` and a
player would skip it.

The harness names that class as this host's `ImageBitmap` when it stands the
host's assets up, which is what `createImageBitmap` returns here anyway, so the
driver needs nothing of its own. The recorder snaps each sprite once through
its scratch canvas and the replay carries the produced art. Every validator's
evidence clip carries it for the same reason.

Check it after a capture: `images` should be non-empty and no `drawImage`
should carry a `$opaque` argument.

## The knobs

| Variable                          | Default | What it does                                                                                                                    |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300`   | The harness's replay cap, patched above to read it. At `2500` a take of this length is kept whole, at 60 fps, with no thinning. |
| `TCAB_SHOWCASE_TAKES`             | `8`     | How many seeds to play and judge.                                                                                               |
| `TCAB_SHOWCASE_FIRST_SEED`        | `1`     | The first seed of that run of takes.                                                                                            |
| `TCAB_SHOWCASE_LEAD_SECONDS`      | `105`   | Run-clock seconds played before the recorder starts.                                                                            |
| `TCAB_SHOWCASE_MIN_SECONDS`       | `24`    | The clip ends at the first kill past this.                                                                                      |
| `TCAB_SHOWCASE_MAX_SECONDS`       | `30`    | The take is abandoned here, wherever it had got to.                                                                             |

A take is judged on what makes a watchable clip of this game: how much of the
crowd is on screen at once, kills taken out of it, level-ups taken and the
tools they put on the HUD, a chest opened, surviving the stretch, and a clean
ending on the beat a kill gives.

## What shipped

The take ran at `TCAB_SHOWCASE_TAKES=10` from seed `1`, at the default bounds
and a `2500`-frame cap, so the replay is whole and unthinned: 1538 frames at
60 fps.

| Winning seed | What it plays                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | 25.6 s from `1:45`, 45 killed, two level-ups taken to level 7 and a sixth tool on the HUD, 19 enemies on screen at the peak, and 92 of 100 health left at the end |

Seven of the ten seeds survived the lead-in; the three that did not fell
between `0:47` and `1:21` and scored far below every take that reached the
recorder.

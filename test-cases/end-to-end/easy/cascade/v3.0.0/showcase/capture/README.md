# Showcase capture drivers

`draw-one.showcase-capture.test.ts` and `draw-three.showcase-capture.test.ts`
(re)record the four media files in `showcase/draw-one/` and
`showcase/draw-three/` from the case's **engineless** reference implementations,
by playing a real game of Cascade: the title screen's NEW GAME control is clicked
with the mouse, the deal the game deals is read, a solve is planned through it,
and that plan is then
performed one ordinary gesture at a time — a click on the stock, a drag of a run
between columns, a double-click that sends a card home — until the game declares
itself won and the victory cascade runs.

Nothing on screen is posed. The debug surface is reached for exactly twice over.
`reset({ seed })` is called once, before the first gesture, and it is what chooses
the deal. `snapshot()` is read throughout — but a read changes nothing: it is how
the driver **checks** that the game did what the plan expected, and a divergence
fails the capture rather than being papered over. Nothing calls `move`,
`autoMove`, `turnStock`, `deal`, `addCard`, `setScreen`, or any pose operation,
and nothing touches the clock: the game runs on its own animation frame, in real
time, which is what makes the recording a recording of the game.

The plan is made with perfect knowledge — the search reads the face-down cards
too, which `snapshot()` reports and a player cannot see. That is what makes a
solve findable at all, and it changes nothing about what reaches the screen:
every move in the plan is a gesture a player could make, and the game accepts or
refuses it on its own rules either way.

## Why a video and not a replay

The case's own recorder writes the `.json.gz` replays the validators' evidence is
made of, and a replay is the preferred moving format for a showcase: smaller,
scrubbable, and recorded at whatever rate the harness drives. It is the wrong
format for **this** clip, and the reason is the victory cascade.

While the cascade runs, the game copies its whole `1280 x 720` painted layer once
per frame (`specs/victory.md`), and that layer changes with every stamp. A draw
recording carries a changed image source as its pixels, so each of those frames
puts a full-stage PNG in the file: a few seconds of cascade is tens of megabytes
before the recorder's own capture budget gives up and starts writing frames with
their images missing. Video is exactly the medium that handles it — the cascade
is the cheapest part of the clip to encode, not the most expensive — so the
capture takes the browser route the authoring guide names for a pointer-driven
case, and Chromium records the page.

## Why `references/none`

All three references play the same game, but only the engineless project runs in
a real browser, and a video capture needs a real screen. The two engine-backed
projects render headless over `@napi-rs/canvas` inside vitest, which draws
nothing anything can record.

## Running it

Stage the validator project into the reference workspace and drop the three
capture files in beside it:

```sh
cd references/none/draw-three          # or references/none/draw-one
npm ci && npm run build                # the suite serves dist/ to Chromium
cp -r ../../../validation/none validation
cp ../../../showcase/capture/showcase-solitaire.ts validation/
cp ../../../showcase/capture/showcase-player.ts validation/
cp ../../../showcase/capture/draw-three.showcase-capture.test.ts \
  validation/showcase-capture.test.ts

TCAB_SHOWCASE_OUT=/tmp/showcase-out \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

Nothing in `validation/none/` is patched, and no validator is touched: the
capture brings its own harness and reuses only `chromium.ts` (finding a browser),
`globalSetup.ts` (serving `dist/` and starting one), `constants.ts` (the figures
the specification fixes) and the pure geometry helpers of `harness.ts`. Copy the
four outputs into `showcase/<variant>/`, then delete the staged `validation/`
directory from the reference workspace.

## The knobs

| Variable                                           | What it does                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_SHOWCASE_OUT`                                | Where the clip and the stills are written. **Unset, the driver plays and reports but writes nothing**, which is how a take is auditioned.           |
| `TCAB_SHOWCASE_SEED`                               | The deal to play. Recording one take is what this file does by default; the committed seed is the default.                                          |
| `TCAB_SHOWCASE_SEEDS`                              | Several seeds, comma-separated, played in turn with the recorder off. Naming more than one is an audition and writes nothing.                       |
| `TCAB_SHOWCASE_SWEEP`                              | A seed range (`1-250`). Solves every deal in it and prints the plan figures, without opening a browser or playing anything.                         |
| `TCAB_SHOWCASE_MAX_MOVES`                          | The longest plan the search will accept, in gestures. It is also the search's main prune, so lowering it makes the search both quicker and pickier. |
| `TCAB_SHOWCASE_MAX_NODES` / `TCAB_SHOWCASE_WEIGHT` | How hard the search looks, and how greedily.                                                                                                        |
| `TCAB_SHOWCASE_MID_STILL`                          | How far into the plan to start looking for the mid-play still, as a share of its gestures.                                                          |
| `TCAB_SHOWCASE_BITRATE`                            | What the recording is re-encoded at. `0` is not accepted; pass a large figure to keep Chromium's own quality.                                       |
| `TCAB_SHOWCASE_FFMPEG`                             | An ffmpeg to re-encode with. Unset, the one Playwright installed is used; with none on the host the recording is kept exactly as Chromium wrote it. |
| `TCAB_SHOWCASE_VERBOSE`                            | `1` prints each gesture and the running count of cards home.                                                                                        |

The re-encode is a compression pass and nothing more — same frames, same order,
same timing. Chromium's screencast writes about 750 kb/s, which for a clip of
this length is four megabytes, and the catalog's preview stage fetches the
leading entry the moment a visitor picks the case; one VP8 pass at `380k` takes
it to a third of that with no visible difference on a table of flat color and
crisp type. The publish pipeline re-encodes it again on its way to `.mp4`
regardless.

## How a take is judged

The capture is deterministic: the same seed deals the same game, the plan is a
function of the deal alone, and the pace is fixed, so a take can be auditioned
with the recorder off and then re-run under it and be the same game.

Auditioning happens in two passes. The first is over the PLANS, and needs no
browser at all — a take is half a minute of Chromium and a plan is a second of
arithmetic, so the seeds worth playing are found on paper and only the short list
is ever played:

```sh
TCAB_SHOWCASE_SWEEP=1-250 npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

Each seed that can be won inside the move budget is printed with the figures that
decide whether its clip is worth watching: how many gestures it takes (which is
very nearly how long the clip runs), how long its longest unbroken stretch of
stock turns is (which is its longest lull), how much of it is cards carried
between piles rather than clicked off the stock, and how many times the stock has
to come back around. A wide range is worth sharding across processes — seeds
1-2000 take about a quarter of an hour split eight ways.

The second pass plays the short list against the real build, with
`TCAB_SHOWCASE_OUT` unset so nothing is written:

```sh
TCAB_SHOWCASE_SEEDS=13,411,479,548,795,1130,1474,1757 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

That is what says how long a take actually runs, and it proves the build accepts
every gesture in the plan. The winner is then recorded.

## What is committed

Both takes were chosen that way, over seeds 1-2000.

### Draw One — seed 13

Eight of the two thousand deals could be won inside the hundred-gesture budget
(13, 411, 479, 548, 795, 1130, 1474 and 1757). All eight were played; seed 13 was
the shortest take of them and tied for the fewest stock turns in a row.

Its game is 95 gestures: 24 turns of the stock with no recycle at all, so the
deck is played out in a single pass; 19 runs carried between piles (11 between
columns, 8 off the waste); and 52 cards sent home by double-click, 36 of them off
the columns and 16 off the waste. Its longest unbroken stretch of stock turns is
six. The take runs 30.3 s from the title screen to the end of the cascade.

- `cascade-solved.webm` — 32.2 s, `1280 x 720` at 25 fps, 0.96 MB after the
  re-encode from Chromium's 2.80 MB. The title screen, NEW GAME, the deal, the
  whole game, and three seconds of the victory cascade.
- `mid-play.png` — the table a third of the way through: the stock still deep,
  the waste showing its single turned card, all four foundations open and four
  columns still holding face-down cards.
- `the-cascade.png` — the cascade three seconds in, the felt already buried.
- `title.png` — the title screen the take opened on, with its DRAW ONE label.

### Draw Three — seed 822

Two hundred and eighty-six of the two thousand deals came in inside a
hundred-and-two gestures, and the eight best on the plan figures were played
(1016, 1102, 822, 75, 865, 1427, 549 and 1474). Seed 822 was taken over the two
shorter takes because it is the least stock-bound game of the eight: the joint
fewest turns of the stock (twelve, with seed 75) and the joint shortest run of
them (two, with seed 865), in a field that mostly turns the stock seventeen to
nineteen times and sits on it three or four turns together.

Its game is 90 gestures: 12 turns of the stock, one of them the recycle that
brings the waste back around; 26 runs carried between piles (12 between columns,
14 off the waste); and 52 cards sent home by double-click, 42 of them off the
columns. The take runs 28.9 s.

- `cascade-solved.webm` — 30.8 s, `1280 x 720` at 25 fps, 1.00 MB after the
  re-encode from Chromium's 3.11 MB.
- `mid-play.png` — the table a third of the way through, with a full three-card
  fan on the waste, all four foundations open, and one column already emptied.
- `the-cascade.png` — the cascade three seconds in.
- `title.png` — the title screen, with its DRAW THREE label.

### Reproducing either

The seed is the driver's default, so the command is the plain one:

```sh
TCAB_SHOWCASE_OUT=/tmp/showcase-out \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The game that is played is fixed by the seed and by the search — `MAX_MOVES`,
`MAX_NODES` and `WEIGHT` at the top of the driver — so changing any of those
changes the plan and therefore the clip, and the stills with it. What does move
between hosts is the clip's exact length, by as much as a second over a take this
long: the pace figures are floors under the browser's own round trips, and a
slower host — or a busier one — spends a little more than the floor on every one
of ninety gestures.

### What comes back byte for byte, and what cannot

Two of the four files reproduce exactly and two do not, and the split is the
difference between a settled table and one in motion.

`title.png` and `mid-play.png` are both taken with nothing moving — the title
screen before the first gesture, and a table left to settle after one — so a
re-run reproduces them byte for byte. A difference in either is a real change in
the build, and worth chasing.

`the-cascade.png` and `cascade-solved.webm` are of the game in motion, and
nothing here touches the clock. The still is taken after a wall-clock wait while
fifty-two cards are in flight on the page's own animation frame, so on a host
that got there sooner it lands a frame or two further along; the clip is a
real-time screencast, re-encoded. Neither will ever match byte for byte, and a
checksum says nothing about either.

Compare them by what they show. Decode the clip to frames and match it against a
second take of the SAME seed, allowing for the drift in length — the figure that
decides it is whether the committed file differs from a fresh take by more than
two fresh takes differ from EACH OTHER. If it does not, nothing has moved. Both
committed clips were checked that way and both cleared it: on downscaled frames,
draw one's committed take sits 0.84/255 mean absolute difference from a fresh one
where two fresh ones sit 1.12 apart, and draw three's sits 1.39 against 1.15.

# Showcase capture drivers

`draw-one.showcase-capture.test.ts` and `draw-three.showcase-capture.test.ts`
(re)record the four media files in `showcase/draw-one/` and
`showcase/draw-three/` from the case's **engineless** reference implementations,
by playing a real game of Cascade: the title screen's NEW GAME control is clicked
with the mouse, the deal the game deals is read, a solve is planned through it,
and that plan is then performed one ordinary gesture at a time — a click on the
stock, a drag of a run between columns, a double-click that sends a card home —
until the game declares itself won and the victory cascade runs.

Nothing on screen is posed, and nothing chooses the deal. The debug surface is
only ever **read**: `snapshot()` is read throughout, but a read changes nothing —
it is how the driver checks that the game did what the plan expected, and a
divergence fails the capture rather than being papered over. Nothing calls
`reset`, `move`, `autoMove`, `turnStock`, `deal`, `addCard`, `setScreen`, or any
pose operation, and nothing touches the clock: the game runs on its own animation
frame, in real time, which is what makes the recording a recording of the game.

Because the deal is the game's own, a capture is an **audition**: the driver
plays several takes, each on whatever deal the game dealt, abandons the takes
whose deal the planner cannot win inside the move budget, and keeps the best of
the ones it could.

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
cp -r ../../../../../../../packages/case-harness/src validation/case-harness
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
| `TCAB_SHOWCASE_OUT`                                | Where the winning take's clip and stills are written. **Unset, the driver plays and reports but writes nothing**, which is how the pace is tuned.   |
| `TCAB_SHOWCASE_TAKES`                              | How many won takes to play before choosing between them. Three by default.                                                                          |
| `TCAB_SHOWCASE_DEALS`                              | How many deals may be dealt looking for those takes. A deal the planner cannot win costs a page load and a search, so the default is generous.      |
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

The plan is a function of the deal alone and the pace is fixed, so what a take
shows is decided by the deal the game happened to shuffle when NEW GAME was
clicked. A deal the planner cannot win inside the move budget is abandoned
before the first gesture: the page is closed, its recording is discarded, and the
next take deals afresh. That costs a page load and a second of search, which is
why the deal budget is generous — under Draw One only a few deals in a thousand
come in under a hundred gestures, and under Draw Three about one in seven.

Every won take is recorded into its own subdirectory of `TCAB_SHOWCASE_OUT` and
reported with the figures that decide whether its clip is worth watching: how
many gestures it takes (which is very nearly how long the clip runs), how long
its longest unbroken stretch of stock turns is (which is its longest lull), how
much of it is cards carried between piles rather than clicked off the stock, and
how many times the stock has to come back around. Once enough takes have been
won the shortest is kept — ties going to the shortest run of stock turns — its
four files are moved up into `TCAB_SHOWCASE_OUT`, and the rest are deleted.

```sh
TCAB_SHOWCASE_OUT=/tmp/showcase-out TCAB_SHOWCASE_TAKES=5 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The figures are printed for every take, so a person can re-run for more takes
when none of a batch reads well, and the winning take proves the build accepts
every gesture in its plan.

## What is committed

Both takes were chosen the same way: eight won deals were played for each
variant, and the take that read best on the figures above was kept.

### Draw One

The committed take was the shortest of its eight and tied for the fewest stock
turns in a row.

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

### Draw Three

The committed take was taken over two shorter ones because it is the least
stock-bound game of its eight: the joint fewest turns of the stock (twelve) and
the joint shortest run of them (two), in a field that mostly turns the stock
seventeen to nineteen times and sits on it three or four turns together.

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

### Re-recording either

The command is the plain one:

```sh
TCAB_SHOWCASE_OUT=/tmp/showcase-out \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

A fresh capture plays a fresh deal, so it is a different game from the committed
one: a different board, a different plan, and a clip of a different length. What
stays the same is everything the deal does not decide — the search (`MAX_MOVES`,
`MAX_NODES` and `WEIGHT` at the top of the driver), the pace figures, and the
build's own look — and changing any of those changes every take. The clip's
exact length also moves between hosts, by as much as a second over a take this
long: the pace figures are floors under the browser's own round trips, and a
slower host — or a busier one — spends a little more than the floor on every one
of ninety gestures.

### What a fresh take says about the committed one

No file comes back byte for byte, because no two takes play the same deal.
`title.png` is the one picture the deal does not touch — the title screen before
the first gesture — so a difference there is a real change in the build's title
screen and worth chasing. Everything else is compared by what it shows: whether
the table is drawn the same way, whether a lifted run is carried the same way,
whether the cascade buries the felt the same way. A fresh take that reads the
same as the committed one on those says nothing has moved; one that does not
names what did.

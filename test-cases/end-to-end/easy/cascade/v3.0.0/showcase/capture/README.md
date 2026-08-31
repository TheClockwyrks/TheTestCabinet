# Showcase capture drivers

`draw-one.showcase-capture.test.ts` and `draw-three.showcase-capture.test.ts`
(re)record the three files in `showcase/draw-one/` and `showcase/draw-three/`
from the case's **engineless** reference implementations, by playing a real game
of Cascade: the title screen's NEW GAME control is clicked with the mouse, the
deal the game deals is read, a solve is planned through it, and that plan is then
performed one ordinary gesture at a time — a click on the stock, a drag of a run
between columns, a double-click that sends a card home — until the game declares
itself won and the victory cascade runs.

Nothing on screen is posed. Two operations of the debug surface are used and both
are used before play begins: `reset({ seed })`, which chooses the deal, and
`snapshot()`, which is read. `snapshot()` is read again after every gesture, but
only to **check** — the driver compares what the game did against what the plan
expected, and a divergence fails the capture rather than being papered over.
Nothing calls `move`, `autoMove`, `turnStock`, `deal`, `addCard`, `setScreen`, or
any pose operation, and nothing touches the clock: the game runs on its own
animation frame, in real time, which is what makes the recording a recording of
the game.

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

While the cascade runs, the game blits its whole `1280 x 720` painted layer once
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
three outputs into `showcase/<variant>/`, then delete the staged `validation/`
directory from the reference workspace.

## The knobs

| Variable | What it does |
| --- | --- |
| `TCAB_SHOWCASE_OUT` | Where the clip and the stills are written. **Unset, the driver plays and reports but writes nothing**, which is how a take is auditioned. |
| `TCAB_SHOWCASE_SEED` | The deal to play. Recording one take is what this file does by default; the committed seed is the default. |
| `TCAB_SHOWCASE_SEEDS` | Several seeds, comma-separated, played in turn with the recorder off. Naming more than one is an audition and writes nothing. |
| `TCAB_SHOWCASE_MAX_MOVES` | The longest plan the search will accept, in gestures. It is also the search's main prune, so lowering it makes the search both quicker and pickier. |
| `TCAB_SHOWCASE_MAX_NODES` / `TCAB_SHOWCASE_WEIGHT` | How hard the search looks, and how greedily. |
| `TCAB_SHOWCASE_MID_STILL` | How far into the plan to start looking for the mid-play still, as a share of its gestures. |
| `TCAB_SHOWCASE_BITRATE` | What the recording is re-encoded at. `0` is not accepted; pass a large figure to keep Chromium's own quality. |
| `TCAB_SHOWCASE_FFMPEG` | An ffmpeg to re-encode with. Unset, the one Playwright installed is used; with none on the host the recording is kept exactly as Chromium wrote it. |
| `TCAB_SHOWCASE_VERBOSE` | `1` prints each gesture and the running count of cards home. |

The re-encode is a compression pass and nothing more — same frames, same order,
same timing. Chromium's screencast writes about 750 kb/s, which for a clip of
this length is four megabytes, and the catalog's preview stage fetches the
leading entry the moment a visitor picks the case; one VP8 pass at `380k` takes
it to a third of that with no visible difference on a table of flat colour and
crisp type. The publish pipeline re-encodes it again on its way to `.mp4`
regardless.

## How a take is judged

The capture is deterministic: the same seed deals the same game, the plan is a
function of the deal alone, and the pace is fixed, so a take can be auditioned
with the recorder off and then re-run under it and be the same game.

Auditioning happens in two passes. The first is over the PLANS, which needs no
browser: every seed in a range is solved inside the move budget and scored on the
things that decide whether a clip is worth watching — how many gestures it takes
(which is how long the clip runs), how long its longest unbroken stretch of stock
turns is (which is its longest lull), how much of it is cards moving between
columns rather than off the stock, and how many times the stock has to be
recycled. The second pass plays the short list against the real build with
`TCAB_SHOWCASE_OUT` unset, which is what says how long a take actually runs and
proves the build accepts every gesture in it. The winner is then recorded.

## What is committed

<!-- FILLED IN BY THE FINAL CAPTURE -->

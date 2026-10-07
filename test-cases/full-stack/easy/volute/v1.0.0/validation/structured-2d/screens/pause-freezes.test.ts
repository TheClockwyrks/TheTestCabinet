// screens/pause-freezes — a paused hall stands still.
//
// WHAT THIS DECIDES. One thing: while the screen is `paused` the train does not
// ride. A build can show a pause banner over a hall that never stopped moving,
// which is why this is a point of its own beside screens/pause-escape.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("What advances on each screen"): "`title`, `paused`,
//   `gameover`, `victory` | Nothing." Only "The accumulated simulation time the
//   debug surface reports stands outside this table", so a paused hall advances
//   no arc position at all.
//   specs/state.md: `accumulator` "is `0` on the screens that hold still", so
//   there is no banked frame time for a paused build to spend either.
//   specs/channel.md ("Advance"): the lead segment advances at the effective
//   feed speed, which is what the head would move at were the pause leaking.
//   specs/instrumentation.md (`pause`): "`pause` poses the pause control, moving
//   the screen to `paused`."
//
// THE DRIVE. An isolated hall: one core on the channel, the inlet stopped with
// `quotaRemaining = 0`, and nothing else posed, so the only thing that can move
// is the thing the requirement is about. The hall is run for a stretch of live
// play first — a hall that was never riding would sit still under a pause that
// leaks, and the check would pass on nothing — and paused through the surface
// rather than through Escape, which screens/pause-escape grades. The frozen
// stretch is 120 ticks, the interval the item names, which is 2 s of simulated
// time and 327 times a tick's worth of movement.
//
// THE TOLERANCES.
//
//   MOVED_MIN = 1 unit, over 30 ticks of play. The ideal is 30 x 22/60 = 11
//   units (level 1's feed speed of 22 units/s, specs/progression.md, at pressure
//   0 with no choke, specs/channel.md). The bound is deliberately an order of
//   magnitude below it: it exists only to establish that the train was riding at
//   all, and the feed RATE is graded by channel/feed-advance, which must be the
//   point that fails when the rate is wrong.
//
//   PAUSE_DRIFT_TOL = 0.2 units on the head's arc position across the paused stretch.
//   The spec's figure is exactly zero, so the only question is how far from zero
//   a conformant build may honestly land. The bound is set below one leaked
//   tick: at level 1's feed speed a single tick moves the head 22/60 = 0.367
//   units, so 0.2 admits no leak at all while leaving room for the float noise
//   of reading the same number back through the snapshot. The standing arc
//   tolerance of 0.5 units would be too loose here — it would swallow a leaked
//   tick whole — and the item's own description states this tighter one, which
//   the standing tolerances allow ("unless a point's own description states
//   otherwise"). A build that simply did not pause drifts 120 x 0.367 = 44
//   units, 220 times the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { PAUSE_DRIFT_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  head,
  poseHall,
  type Harness,
} from "../harness";

/** Where the lone core is posed: clear of the inlet, the intake and the danger band. */
const POSED_S = 1000;

/** Ticks of live play run before the pause, so the train is demonstrably riding. */
const PLAY_TICKS = 30;

/** Ticks held paused: the interval the item names, 2 s of simulated time. */
const PAUSED_TICKS = 120;

/** The head must have ridden at least this far over {@link PLAY_TICKS}. */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the head's arc position where the pause found it", async () => {
  await poseHall(h, { level: 1, cores: [[POSED_S, "halide", null]] });
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the hall is posed on");

  const paused = await captureReplay(h, "frozen", async () => {
    await h.step(PLAY_TICKS);
    h.debug.pause();
    const at = h.snapshot();
    await h.step(PAUSED_TICKS);
    return at;
  });

  assertEqual(paused.screen, "paused", "the screen the hall was held on");
  assertGreaterThan(
    head(paused).s - head(posed).s,
    MOVED_MIN,
    "units the head rode before the pause",
  );

  const later = h.snapshot();
  assertEqual(later.screen, "paused", "the screen the hall was held on");
  assertNear(
    head(later).s,
    head(paused).s,
    PAUSE_DRIFT_TOL,
    `the head's arc position after ${PAUSED_TICKS} paused ticks`,
  );
});

// channel/self-advancing — the hall runs on its own clock.
//
// THE SPEC LINE. `specs/instrumentation.md`, "A deterministic core": every rate
// is "integrated against the delta time the engine hands each tick", and "The
// engine advances the game frame by frame and a clock that supplies its own
// deltas takes it off real time" — so a game handed a REAL clock and the
// engine's own loop, with nothing stepping it, is a game running itself.
// `specs/channel.md`'s advance table is what that running produces: the lead
// segment gains the effective feed speed every second of it. So a hall left to
// run must carry the train forward.
//
// THE DRIVE. An isolated hall with one core on the channel and the inlet
// stopped, so nothing but the advance can move the reading. The harness swaps
// the scenario's scripted clock for a wall clock, hands the loop back for six
// hundred milliseconds of real time, and then takes both back; the head's arc
// position is read either side.
//
// THE BOUND, AND WHY IT IS WHAT IT IS. The requirement is that the hall advances
// at all without being poked — a build that only moves when something steps it
// stays exactly where it was put. So the reading is a movement, not a rate: how
// FAST the train rides is `channel/feed-advance`'s point, measured against
// scripted ticks where it can be measured exactly, and asserting a rate here
// would grade the host's scheduling of a loop rather than the build. The bound
// is one tick's worth of travel at level 1's feed speed — 22/60 of a unit — which
// is the smallest advance a running clock can produce and comfortably above
// floating-point noise, while six hundred milliseconds of a clock that runs at
// all delivers thirty-odd times it. Nothing about how many frames the host
// granted the loop enters the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { TICK_HZ, levelSpec } from "../constants";
import {
  captureStill,
  createHarness,
  head,
  poseHall,
  type Harness,
} from "../harness";

/** Where the core is posed: clear of the inlet and nowhere near the intake. */
const START_S = 1000;

/** The stretch of REAL time the hall is left to run itself. */
const RUN_MS = 600;

/** The level this is posed on, and the feed speed its row fixes. */
const LEVEL = 1;

/** One tick's worth of travel: the smallest advance a running clock produces. */
const MIN_GAIN = levelSpec(LEVEL).feed / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the train forward on its own clock, unstepped", async () => {
  await poseHall(h, {
    level: LEVEL,
    quotaRemaining: 0,
    cores: [[START_S, "halide", null]],
  });

  // One frame, so the picture kept below is the posed hall and the reading
  // taken with it is the state that frame left.
  const opening = await h.step(1);
  captureStill(h, "before");
  const before = head(opening).s;

  // A real clock and the engine's own loop, with nothing stepping it.
  await h.runFor(RUN_MS);

  const after = head(h.snapshot()).s;
  captureStill(h, "after");

  assertGreaterThan(
    after - before,
    MIN_GAIN,
    `the arc the head gained over ${RUN_MS} ms of a clock left to run`,
  );
});

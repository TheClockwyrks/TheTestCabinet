// channel/self-advancing — the hall runs under the engine's own frame loop.
//
// THE SPEC LINE. `specs/instrumentation.md`, "A deterministic core": "The hall
// advances on a fixed tick of `TICK_HZ` (`60`) ticks per second ... every
// frame's delta time accumulates, whole ticks are consumed, and the remainder
// waits for the next frame", and "The engine advances the game frame by frame".
// `specs/channel.md`'s advance table is what that running produces: the lead
// segment gains the effective feed speed every second of it. So a hall left under
// the loop that drives a played game, with nothing stepping it, must carry the
// train forward.
//
// THE DRIVE. An isolated hall with one core on the channel and the inlet
// stopped, so nothing but the advance can move the reading. The harness puts a
// wall clock under the engine and runs its own loop for six hundred milliseconds
// before taking the scripted clock back; the head's arc position is read either
// side. This is the ONE check in this project that depends on real elapsed time,
// because it is the one requirement that is about the loop rather than about a
// counted number of ticks.
//
// THE BOUND, AND WHY IT IS WHAT IT IS. The requirement is that the hall advances
// at all without being poked — a build that only moves when something steps it
// stays exactly where it was put. So the reading is a movement, not a rate: how
// FAST the train rides is `channel/feed-advance`'s point, measured against
// simulated ticks where it can be measured exactly, and asserting a rate here
// would grade the host's scheduling of a frame callback rather than the build.
// The bound is one tick's worth of travel at level 1's feed speed — 22/60 of a
// unit — which is the smallest advance a running clock can produce and comfortably
// above floating-point noise, while six hundred milliseconds of a clock that runs
// at all delivers thirty-odd times it. Nothing about how many frames the host
// scheduled enters the verdict.

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

/** The stretch of REAL time the build is left to run itself. */
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

it("carries the train forward under the engine's own loop, unstepped", async () => {
  await poseHall(h, {
    level: LEVEL,
    quotaRemaining: 0,
    cores: [[START_S, "halide", null]],
  });

  // The engine draws only inside a frame, so one tick is run before the picture
  // is taken: nothing renders under this engine until something advances it.
  await h.step(1);
  await captureStill(h, "before");
  const before = head(await h.snapshot()).s;

  // The engine's own loop over a wall clock, and nothing stepping it.
  await h.runFor(RUN_MS);

  const after = head(await h.snapshot()).s;
  await captureStill(h, "after");

  assertGreaterThan(
    after - before,
    MIN_GAIN,
    `the arc the head gained over ${RUN_MS} ms of the build's own clock`,
  );
});

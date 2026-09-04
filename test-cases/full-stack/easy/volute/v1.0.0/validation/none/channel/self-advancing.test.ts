// channel/self-advancing — the hall runs on the build's own clock.
//
// THE SPEC LINE. `specs/instrumentation.md`, "A deterministic core": "The hall
// advances on a fixed tick of `TICK_HZ` (`60`) ticks per second ... every
// frame's delta time accumulates, whole ticks are consumed, and the remainder
// waits for the next frame", and `setAutoStep`: "`setAutoStep(true)` returns it
// to running itself, which is how a build starts and how it is played."
// `specs/channel.md`'s advance table is what that running produces: the lead
// segment gains the effective feed speed every second of it. So a build handed
// back its own clock, with nothing stepping it, must carry the train forward.
//
// ENGINELESS ONLY, WHICH IS WHY THIS FILE HAS NO COUNTERPART NEXT DOOR. The
// manifest scopes the point with `engines = ["none"]`. Here the frame loop is a
// deliverable: the build writes the requestAnimationFrame loop, the accumulator
// and the fixed tick under them, and a build that wrote none of it stands still.
// Under either engine the loop is the ENGINE's — the seeded `src/main.ts`, which
// a build does not edit, stands the engine up and runs it — so the point would
// grade the engine rather than the build, and the build's own residue (that its
// `update` integrates against the dt it is handed) is `channel/feed-advance`'s
// point, measured there against counted ticks where it can be measured exactly.
//
// THE DRIVE. An isolated hall with one core on the channel and the inlet
// stopped, so nothing but the advance can move the reading. The harness hands
// the build its own wall clock for six hundred milliseconds and then takes it
// back; the head's arc position is read either side.
//
// THE BOUND, AND WHY IT IS WHAT IT IS. The requirement is that the hall advances
// at all without being poked — a build that only moves when something steps it
// stays exactly where it was put. So the reading is a movement, not a rate: how
// FAST the train rides is `channel/feed-advance`'s point, measured against
// simulated ticks where it can be measured exactly, and asserting a rate here
// would grade the host's scheduling of a page rather than the build. The bound
// is one tick's worth of travel at level 1's feed speed — 22/60 of a unit — which
// is the smallest advance a running clock can produce and comfortably above
// floating-point noise, while six hundred milliseconds of a clock that runs at
// all delivers thirty-odd times it. Nothing about how many frames the browser
// grants the page enters the verdict.

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

/** Long enough for the build's own render loop to have drawn the hall. */
const RENDER_MS = 120;

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
    cores: [[START_S, "halide", null]],
  });

  await h.page.waitForTimeout(RENDER_MS);
  await captureStill(h, "before");
  const before = head(await h.snapshot()).s;

  // The build's own clock, and nothing stepping it.
  await h.runFor(RUN_MS);

  const after = head(await h.snapshot()).s;
  await captureStill(h, "after");

  assertGreaterThan(
    after - before,
    MIN_GAIN,
    `the arc the head gained over ${RUN_MS} ms of the build's own clock`,
  );
});

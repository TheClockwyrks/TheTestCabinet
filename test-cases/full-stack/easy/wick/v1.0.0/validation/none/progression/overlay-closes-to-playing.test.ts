// progression/overlay-closes-to-playing — the last acceptance returns to
// playing.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"): "When
// level-ups remain queued the next overlay opens immediately ... OTHERWISE
// `screen` RETURNS TO `playing` AND THE SIMULATION RESUMES ON THE NEXT TICK."
// While the overlay stands, "the simulation does not tick while it is open", so
// `tick` holds; once it closes, the next frame is a tick again, and
// specs/instrumentation.md's `step` "runs one whole frame of the loop ... a tick
// each on `playing`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no slot held, so the pool has offers to accept and nothing
// in the world moves on the tick that follows, leaving `run.tick` as the one
// figure that answers whether the simulation resumed. The queue is posed at `1`,
// which is the case this point is about: the LAST acceptance. Both halves are
// read, the screen the acceptance left and the tick the following frame ran, so
// a build that returns to `playing` and stays frozen fails as surely as one that
// stays on the overlay.
//
// THE TOLERANCE. None: a screen name and a tick number are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level-ups queued: one, so the acceptance is the last. */
const QUEUED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing and ticks again on the next frame", async () => {
  await isolate(h);

  const overlay = await openLevelUp(h, QUEUED);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertGreaterThan(
    overlay.run.offers.length,
    0,
    "the offers the overlay presents",
  );

  await h.debug.choose(0);
  const accepted = await h.snapshot();
  assertEqual(
    accepted.screen,
    "playing",
    "the screen the last acceptance left",
  );
  assertEqual(
    accepted.run.pendingLevelUps,
    0,
    "the queue the last acceptance left",
  );

  const resumed = await h.step(1);
  await captureStill(h, "closed");

  assertEqual(
    resumed.screen,
    "playing",
    "the screen the frame after the acceptance left",
  );
  assertEqual(
    resumed.run.tick,
    accepted.run.tick + 1,
    "the run clock after the frame that follows the acceptance",
  );
});

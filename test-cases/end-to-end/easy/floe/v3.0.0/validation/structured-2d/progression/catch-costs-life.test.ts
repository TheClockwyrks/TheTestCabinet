// progression/catch-costs-life — a bear reaching the critter costs the run exactly
// one life and puts the crossing into its dying hold.
//
// specs/progression.md lists the catch first among the five things that cost a
// life, and fixes what every one of them costs: "On the tick a life is lost:
// `lives` drops by exactly one, `phase` becomes `dying`". specs/hunter.md fixes
// the reach itself, and `hunter/catches` and `hunter/no-catch-beyond-range` grade
// the distance it happens at.
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. This is one of the five that ask
// whether the RUN answers a death, and it is the catch's own. So the bear is posed
// exactly ON the critter — a distance of zero, well inside a rule this point is
// not grading — and what is read is the life and the phase.
//
// THE BEAR IS POSED WITH ALL THREE FACULTIES OFF. A catch is the run's own
// faculty, gated by `setCatchTest` (specs/instrumentation.md), and none of the
// bear's three is on the route: it does not have to sense the critter to be
// standing on it, it does not have to route anywhere, and it must not travel off
// the tile before the tick runs. `addBear` leaves its target on its own tile, so
// nothing it holds refers to the critter at all.
//
// `setCatchTest(true)` is the one gate this point turns back on, because the catch
// test IS its requirement.
//
// The delta is read rather than the absolute, so a build that mis-posed the
// counter fails the point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";

/** The tile the meeting happens on: the one a crossing begins from. */
const COL = START_COL;
const ROW = ROW_NEAR;

/** The one frame the catch test needs, and the frames of the hold kept as evidence. */
const CATCH_FRAMES = 1;
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes one life and starts the dying hold when a bear reaches the critter", async () => {
  startCrossing(h);
  poseBear(h, COL, ROW, { sense: false, routing: false, travel: false });
  h.debug.setCatchTest(true);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the catch");
  assertEqual(before.critter.present, true, "a critter on the strait to reach");

  const after = await captureReplay(h, "death", async () => {
    await h.advance(CATCH_FRAMES);
    const caught = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return caught;
  });

  assertEqual(
    before.lives - after.lives,
    1,
    "the one life a catch costs (specs/progression.md)",
  );
  assertEqual(after.phase, "dying", "the hold a lost life starts");
});

// progression/catch-costs-life — a bear reaching the critter costs the run
// exactly one life and puts the crossing into its dying hold.
//
// specs/progression.md lists the catch first among the five things that cost a
// life, and fixes what every one of them costs: "On the tick a life is lost:
// `lives` drops by exactly one, `phase` becomes `dying`". specs/hunter.md fixes
// the reach itself: a bear catches the critter when the distance between their
// centres "is at most `BEAR_CATCH_DIST` (`18`) stage units".
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. Whether the catch happens at the
// right distance is `hunter/catches` and `hunter/no-catch-beyond-range`; this
// point is one of the five that ask whether the RUN answers a death, and it is
// the catch's own. So the bear is posed exactly on the critter — a distance of
// zero, well inside a rule this point is not grading — and what is read is the
// life and the phase.
//
// THE BEAR IS POSED WITH ALL THREE FACULTIES OFF. A catch is the run's own
// faculty, gated by `setCatchTest` (specs/instrumentation.md), and none of the
// bear's three is on the route: it does not have to sense the critter to be
// standing on it, it does not have to route anywhere, and it must not travel off
// the tile before the tick runs. Its target is posed to its own tile so that
// nothing it holds refers to the critter at all.
//
// `setCatchTest(true)` is the one gate this point turns back on, because the
// catch test IS its requirement.
//
// The delta is read rather than the absolute, so a build that mis-posed the
// counter fails the point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ROW_NEAR, START_COL } from "../constants";
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

/** The one tick the catch test needs, and the ticks of the hold kept as evidence. */
const CATCH_TICKS = 1;
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes one life and starts the dying hold when a bear reaches the critter", async () => {
  await startCrossing(h);
  await poseBear(h, COL, ROW, {
    sense: false,
    routing: false,
    travel: false,
    target: { col: COL, row: ROW },
  });
  await h.debug.setCatchTest(true);

  const before = await h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the catch");

  const after = await captureReplay(h, "death", async () => {
    await h.advance(CATCH_TICKS);
    const caught = await h.snapshot();
    await h.advance(AFTER_TICKS);
    return caught;
  });

  assertEqual(
    before.lives - after.lives,
    1,
    "the one life a catch costs (specs/progression.md)",
  );
  assertEqual(after.phase, "dying", "the hold a lost life starts");
});

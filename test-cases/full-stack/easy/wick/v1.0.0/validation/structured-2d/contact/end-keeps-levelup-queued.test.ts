// contact/end-keeps-levelup-queued — an ending tick opens no level-up
// overlay and leaves the level-up queued.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn": "A tick that ends the
// run opens no overlay: … a level-up it queued stays queued." The phase
// order says the same, "One tick" step 12: "A tick that ends the run opens no
// overlay. Otherwise … a tick that ends with a level-up queued and no chest
// collected opens the level-up overlay". And `specs/progression.md`, The
// level-up overlay: "A tick that ends the run ends it and opens no overlay,
// chest or level-up."
//
// THE POSE. `setPendingLevelUps(1)`, which on its own would open the overlay
// at the end of the next `playing` tick ("A `playing` tick that ends with it
// above `0` opens the overlay exactly as a gain does",
// `specs/instrumentation.md`), and `setHp(0)`, which "ends the run fallen at
// the end of the next `playing` tick, through the ending rule". One tick then
// has both a queued level-up and an ending, and the reading is which the
// build honored: the screen is `fallen`, not `levelup`, and
// `pendingLevelUps` still reads `1`.
//
// WHY A POSED HP RATHER THAN A HIT. The point is the overlay rule at an
// ending, not how the ending came about; `fallen-at-zero` grades the ending
// itself through a hit. Nothing is in the world and every switch is off, so
// the tick has nothing else to do.
//
// THE TOLERANCE. A screen name and a count, exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The level-ups queued before the ending tick. */
const QUEUED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends fallen with the level-up still queued rather than opening its overlay", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(QUEUED);
  h.debug.setHp(0);
  assertEqual(
    h.snapshot().run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps read back after the pose",
  );

  const after = await advanceTicks(h, 1);
  captureStill(h, "queued");

  assertEqual(
    after.screen,
    "fallen",
    "the screen at the end of a tick that both ends the run and has a level-up queued (specs/world.md, Fallen and dawn)",
  );
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps on the end screen: the level-up stays queued (specs/world.md, Fallen and dawn)",
  );
});

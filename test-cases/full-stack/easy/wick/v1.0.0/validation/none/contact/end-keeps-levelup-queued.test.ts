// contact/end-keeps-levelup-queued — an ending tick opens no level-up overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "A tick
// that ends the run opens no overlay: ... a level-up it queued stays queued."
// Phase 12 of "One tick" puts it in order: "A tick that ends the run opens no
// overlay. Otherwise ... a tick that ends with a level-up queued and no chest
// collected opens the level-up overlay". specs/progression.md ("The level-up
// overlay") agrees: "A tick that ends the run ends it and opens no overlay,
// chest or level-up." So with one level-up queued and `hp` at 0, the tick ends
// on `fallen` and `pendingLevelUps` still reads 1.
//
// THE DRIVE. An isolated night with every faculty held and nothing alive.
// `pendingLevelUps` is posed to 1 through `setPendingLevelUps`, which "A
// `playing` tick that ends with it above `0` opens the overlay exactly as a gain
// does" (specs/instrumentation.md), and `hp` is posed to -1 through `setHp`,
// which "ends the run fallen at the end of the next `playing` tick" for "A value
// at or below `0`". Below 0 rather than at it, so this point turns on the
// overlay rule alone: the boundary at exactly 0 is
// `contact/fallen-at-exactly-zero`'s. Recovery is 0 with no Tinder held, so
// nothing lifts `hp` back over 0. One tick is run: a build that opens the
// overlay first reads `levelup`, and one that consumes the queue on the way out
// reads 0.
//
// THE TOLERANCE. None: a screen name and a count are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The level-ups queued before the ending tick. */
const QUEUED = 1;

/** The health posed: below 0, so the tick ends the run. */
const POSED_HP = -1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends fallen with the level-up still queued and no overlay opened", async () => {
  await isolate(h);
  await h.debug.setPendingLevelUps(QUEUED);
  await h.debug.setHp(POSED_HP);

  const after = await h.step(1);

  // The screen the ending tick left. Captured before the assertions, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "queued");

  assertEqual(
    after.screen,
    "fallen",
    "the screen an ending tick with a level-up queued leaves",
  );
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps after the ending tick",
  );
});

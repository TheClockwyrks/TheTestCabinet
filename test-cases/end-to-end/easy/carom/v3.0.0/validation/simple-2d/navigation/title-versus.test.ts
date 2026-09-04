// Carom — navigation/title-versus: confirming VERSUS starts a Versus match.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The selection is put on the `VERSUS` entry by `setMenuIndex`, which is the
// precondition this point names; pressing down to it would fail this point for a
// broken down edge, which is `navigation/title-down`'s to report.
//
// What is read is what "Starting a match" fixes and this item names: `mode` is
// `versus`, `screen` is `countdown`, and both scores are `0`. How the countdown
// then runs, and the serve that ends it, are the gameplay category's points.
//
// The field is left exactly as the title state holds it. `reset` puts the ball at
// its home with a full `HOLD_TIME` hold, so a single frame cannot serve it out of
// the countdown this reads, and no reading here is of a ball or an obstacle. No
// paddle is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

const VERSUS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a Versus match from the second title item", async () => {
  assertEqual(TITLE_ITEMS[VERSUS], "VERSUS");
  openTitle(h);
  h.debug.setMenuIndex(VERSUS);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, VERSUS);

  await h.tap("Enter");
  captureStill(h, "countdown");

  const started = h.snapshot();
  assertEqual(started.mode, "versus");
  assertEqual(started.screen, "countdown");
  assertDeepEqual(started.score, { p1: 0, p2: 0 });
});

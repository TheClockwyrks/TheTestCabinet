// Carom — navigation/title-solo: confirming SOLO starts a Solo match.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The title is posed by `openTitle`, which is `reset`, and `reset` leaves
// `menuIndex` at `0` — the `SOLO` entry — so the precondition this point names is
// read back off the snapshot and the confirm is the only edge pressed.
//
// What is read is what "Starting a match" fixes and this item names: `mode` is
// `solo`, `screen` is `countdown`, and both scores are `0`. How the countdown
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a Solo match from the first title item", async () => {
  assertEqual(TITLE_ITEMS[0], "SOLO");
  openTitle(h);
  const opened = h.snapshot();
  assertEqual(opened.screen, "title");
  assertEqual(opened.menuIndex, 0);

  await h.tap("Enter");
  captureStill(h, "countdown");

  const started = h.snapshot();
  assertEqual(started.mode, "solo");
  assertEqual(started.screen, "countdown");
  assertDeepEqual(started.score, { p1: 0, p2: 0 });
});

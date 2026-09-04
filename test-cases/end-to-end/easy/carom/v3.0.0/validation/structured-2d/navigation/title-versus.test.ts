// Carom — navigation/title-versus: confirming VERSUS starts a Versus match.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; the reset is
// settled with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. Every key is a real key
// event dispatched at the target the engine listens on, so the action is raised
// by the binding the case declares, and the result is read back off the game's
// own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuIndex0,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a Versus match from the second title item", async () => {
  h.debug.reset();
  await h.advance(1);
  assertEqual(TITLE_ITEMS[1], "VERSUS");
  await h.tap("ArrowDown");
  assertEqual(menuIndex0(h), 1);
  await h.tap("Enter");
  captureStill(h, "countdown");

  const opened = h.snapshot();
  assertEqual(opened.mode, "versus");
  assertEqual(opened.screen, "countdown");
  assertDeepEqual(opened.score, { p1: 0, p2: 0 });
});

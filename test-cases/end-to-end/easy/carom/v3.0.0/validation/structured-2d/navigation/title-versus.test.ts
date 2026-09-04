// Carom — navigation/title-versus: confirming VERSUS starts a Versus match.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; `openTitle` settles
// that reset with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. Every key is a real key
// event dispatched at the target the engine listens on, so the action is raised
// by the binding the case declares, and the result is read back off the game's
// own state. The still is the frame the press left.
//
// The entry this point confirms is POSED with `setMenuIndex` rather than walked
// to with arrow presses. Walking there would put the movement edges inside a
// check about a confirm, so a build with a broken down edge would fail this
// point as well as `title-down`; the ground a check presses its one key from is
// its ground rather than its subject.
//
// The field is left exactly as `reset` arranged it. What "Starting a match"
// fixes is the arrangement the build itself must make from the title, so posing
// or clearing anything on the field first would replace the very thing the
// confirm is being read for.

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

it("starts a Versus match from the second title item", async () => {
  await openTitle(h);
  assertEqual(TITLE_ITEMS[1], "VERSUS");
  h.debug.setMenuIndex(1);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 1);

  await h.tap("Enter");
  captureStill(h, "countdown");

  const opened = h.snapshot();
  assertEqual(opened.mode, "versus");
  assertEqual(opened.screen, "countdown");
  assertDeepEqual(opened.score, { p1: 0, p2: 0 });
});

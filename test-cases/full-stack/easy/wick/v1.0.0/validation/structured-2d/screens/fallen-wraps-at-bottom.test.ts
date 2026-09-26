// Wick — screens/fallen-wraps-at-bottom: `down` on the last fallen item
// wraps the highlight to the first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`", gives both end screens one menu, `END_ITEMS` (`TRY AGAIN`, `TITLE`,
// "in that order"): "`menuIndex` is `0` on arriving. `up` and `down` move the
// highlight and wrap, and `confirm` takes the highlighted item".
// `specs/controls.md` gives the `fallen`, `dawn` row "`up`, `down` move the
// highlight, wrapping at both ends". `END_ITEMS` holds two items, so the last
// index is `1` and a `down` there reads `0`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended
// fallen by posing `hp` to `0` and running the one tick `specs/world.md` ends
// the run on, then one real `ArrowDown` onto
// the last item, read back as the precondition, then the `ArrowDown` that
// must wrap. The edge case is its own point: a build that moves the highlight
// correctly and clamps at the bottom fails here alone.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  isolate,
  tap,
  type Harness,
} from "../harness";

/** The last item of an end screen's menu (specs/ui.md, END_ITEMS). */
const LAST_ITEM = END_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after ArrowDown on the last fallen item", async () => {
  isolate(h);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the press is made on");

  let posed = ended;
  for (let step = 0; step < LAST_ITEM; step += 1) {
    posed = await tap(h, "ArrowDown");
  }
  assertEqual(posed.menuIndex, LAST_ITEM, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "fallen", "the screen after the wrapping press");
  assertEqual(after.menuIndex, 0, "menuIndex after ArrowDown past the bottom");
});

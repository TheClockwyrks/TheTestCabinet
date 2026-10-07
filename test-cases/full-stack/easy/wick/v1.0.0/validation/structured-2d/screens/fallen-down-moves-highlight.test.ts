// Wick — screens/fallen-down-moves-highlight: `down` moves the fallen
// screen's menu highlight to the next item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`", gives both end screens one menu, `END_ITEMS` (`TRY AGAIN`, `TITLE`,
// "in that order"): "`menuIndex` is `0` on arriving. `up` and `down` move the
// highlight and wrap, and `confirm` takes the highlighted item".
// `specs/controls.md` gives the `fallen`, `dawn` row "`up`, `down` move the
// highlight, wrapping at both ends", and binds `down` to `ArrowDown` and
// `KeyS`; with two items, index `0` moves to index `1`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended
// fallen by posing `hp` to `0` and running the one tick `specs/world.md` ends
// the run on. Then one real `ArrowDown`, on the
// index the arrival highlights.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  endFallen,
  isolate,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 after one ArrowDown on the fallen screen", async () => {
  isolate(h);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the press is made on");
  assertEqual(ended.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "fallen", "the screen after ArrowDown");
  assertEqual(after.menuIndex, 1, "menuIndex after one ArrowDown");
});

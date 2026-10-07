// Wick — screens/dawn-down-moves-highlight: `down` moves the dawn screen's
// menu highlight to the next item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`", gives both end screens one menu, `END_ITEMS` (`TRY AGAIN`, `TITLE`,
// "in that order"): "`menuIndex` is `0` on arriving. `up` and `down` move the
// highlight and wrap, and `confirm` takes the highlighted item".
// `specs/controls.md` gives the `fallen`, `dawn` row "`up`, `down` move the
// highlight, wrapping at both ends", and binds `down` to `ArrowDown` and
// `KeyS`; with two items, index `0` moves to index `1`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended at
// dawn by posing the clock to `LAST_TICK` (`35999`) and running the one tick
// that carries it to `DAWN_TIME × TICK_HZ` (`36000`). Then one real
// `ArrowDown`, on the index the arrival highlights.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  endDawn,
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

it("reads menuIndex 1 after one ArrowDown on the dawn screen", async () => {
  isolate(h);
  const ended = await endDawn(h);
  assertEqual(ended.screen, "dawn", "the screen the press is made on");
  assertEqual(ended.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "dawn", "the screen after ArrowDown");
  assertEqual(after.menuIndex, 1, "menuIndex after one ArrowDown");
});

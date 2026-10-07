// Wick — screens/dawn-up-moves-highlight: `up` moves the dawn screen's menu
// highlight to the item above.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`", gives both end screens one menu, `END_ITEMS` (`TRY AGAIN`, `TITLE`,
// "in that order"): "`menuIndex` is `0` on arriving. `up` and `down` move the
// highlight and wrap, and `confirm` takes the highlighted item".
// `specs/controls.md` gives the `fallen`, `dawn` row "`up`, `down` move the
// highlight, wrapping at both ends", and binds `up` to `ArrowUp` and `KeyW`;
// from index `1` a move up is a move by one item, to `0`, with no wrap
// involved.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended at
// dawn by posing the clock to `LAST_TICK` (`35999`) and running the one tick
// that carries it to `DAWN_TIME × TICK_HZ` (`36000`), then one real `ArrowDown`
// onto the second item, read back as the precondition, then the `ArrowUp` this
// point is about. The debug surface carries no operation that poses `menuIndex`
// (`specs/instrumentation.md`), so the menu's own `down` is the only way onto
// the second item.
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

it("reads menuIndex 0 after ArrowUp from the second dawn item", async () => {
  isolate(h);
  const ended = await endDawn(h);
  assertEqual(ended.screen, "dawn", "the screen the press is made on");

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.menuIndex, 1, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "dawn", "the screen after ArrowUp");
  assertEqual(after.menuIndex, 0, "menuIndex after one ArrowUp");
});

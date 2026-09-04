// Wick — screens/dawn-wraps-at-top: `up` on the first dawn item wraps the
// highlight to the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`", gives both end screens one menu, `END_ITEMS` (`TRY AGAIN`, `TITLE`,
// "in that order"): "`menuIndex` is `0` on arriving. `up` and `down` move the
// highlight and wrap, and `confirm` takes the highlighted item".
// `specs/controls.md` gives the `fallen`, `dawn` row "`up`, `down` move the
// highlight, wrapping at both ends". `END_ITEMS` holds two items, so an `up`
// from `0` reads the last index, `1`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended at
// dawn by posing the clock to `LAST_TICK` (`35999`) and running the one tick
// that carries it to `DAWN_TIME × TICK_HZ` (`36000`), which arrives on index
// `0`, and one real `ArrowUp`. Nothing is pressed first, so the wrap is the
// only thing the reading can be about.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
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

it("reads the last dawn item after ArrowUp on the first", async () => {
  isolate(h);
  const ended = await endDawn(h);
  assertEqual(ended.screen, "dawn", "the screen the press is made on");
  assertEqual(ended.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "dawn", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    LAST_ITEM,
    "menuIndex after ArrowUp past the top",
  );
});

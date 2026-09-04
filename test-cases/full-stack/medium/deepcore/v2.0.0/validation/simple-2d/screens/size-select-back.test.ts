// screens/size-select-back — BACK on the size choice returns to the mode choice.
//
// specs/ui.md: on `size-select`, "`BACK` returns to `mode-select`" — one step
// back rather than all the way out, so the mode already chosen can be changed
// without starting over. `BACK` is the fourth entry of `SIZE_ITEMS`.
//
// THE STEP IS TAKEN FOR REAL. The size choice is reached by choosing a mode on
// the mode choice, so what `BACK` returns to is the screen the session actually
// came from, and the check reads that the mode can then be changed: `HARDCORE` is
// taken on the way in and `STANDARD` on the way back, and the expedition that
// eventually begins is Standard.
//
// ISOLATION. The mode choice reached directly through the surface rather than
// through the title, because a build with a broken title menu must fail that
// check and pass this one.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS, SIZE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the mode choice, where the mode can still be changed", async () => {
  h.debug.reset();
  h.debug.setScreen("mode-select");

  h.debug.setMenuIndex(MODE_ITEMS.indexOf("HARDCORE"));
  await h.tap(ACTION_KEY.activate);
  assertEqual(
    h.snapshot().screen,
    "size-select",
    "specs/ui.md: a mode goes to size-select",
  );

  h.debug.setMenuIndex(SIZE_ITEMS.indexOf("BACK"));
  await h.tap(ACTION_KEY.activate);

  const back = h.snapshot();
  captureStill(h, "back");
  assertEqual(
    back.screen,
    "mode-select",
    "specs/ui.md: BACK on size-select returns to mode-select rather than to the title",
  );

  // The mode really is still there to be changed: the other one is taken, and
  // the expedition that begins is played in it.
  h.debug.setMenuIndex(MODE_ITEMS.indexOf("STANDARD"));
  await h.tap(ACTION_KEY.activate);
  h.debug.setMenuIndex(SIZE_ITEMS.indexOf("QUICK"));
  await h.tap(ACTION_KEY.activate);

  const started = h.snapshot();
  assertEqual(
    started.screen,
    "in-mine",
    "specs/ui.md: choosing a size begins the expedition",
  );
  assertEqual(
    started.mode,
    "standard",
    "specs/ui.md: the mode chosen after BACK is the one the expedition opens in",
  );
});

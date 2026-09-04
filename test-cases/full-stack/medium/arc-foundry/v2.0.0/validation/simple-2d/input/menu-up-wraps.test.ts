// input/menu-up-wraps — the up action wraps from the first entry to the last.
//
// THE REQUIREMENT. `specs/ui.md` states it for every menu at once: "On every
// menu, the up and down actions move the highlight by one entry and wrap at both
// ends." `specs/controls.md` binds `up` to `ArrowUp`, and
// `specs/instrumentation.md` reports the highlight as `menuIndex`, counted
// from `0`.
//
// THE STEP AND THE WRAP ARE TWO POINTS. A build whose highlight moves but never
// wraps and a build whose menu keys do nothing at all must not grade the same, and
// the wrap is an edge case of the stepping rule, which earns a check of its own.
// So `menu-up-moves` decides the step and `menu-up-wraps` decides the
// boundary.
//
// THE MENU IT IS DECIDED ON is the map select, because `specs/ui.md` gives it four
// entries — three maps and a `BACK` — so a step of one and a wrap to the last are
// different answers, which they would not be on a two-entry menu. The key is
// pressed as a player presses it, a real key event dispatched at the engine's own surface. The entry count is read off the build's
// own `menuButtons`, so no layout and no fixed number of maps is assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  pressAction,
} from "../harness";
import { keyFor } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("wraps to the last entry from the first", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  assertGreaterThanOrEqual(
    entries.length,
    2,
    "the map select to present more than one entry, so wrapping to the far end " +
      "is a different answer from standing still (specs/ui.md)",
  );

  h.debug.setMenuIndex(0);
  await pressAction(h, "up");
  captureStill(h, "wrap");
  assertEqual(
    h.snapshot().menuIndex,
    entries.length - 1,
    `the highlight after ${keyFor("up")} from the first of ${entries.length} ` +
      "entries, which wraps to the last (specs/ui.md)",
  );
});

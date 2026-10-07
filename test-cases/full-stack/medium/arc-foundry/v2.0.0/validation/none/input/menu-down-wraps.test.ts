// input/menu-down-wraps — the down action wraps from the last entry to the first.
//
// THE REQUIREMENT. `specs/ui.md` states it for every menu at once: "On every
// menu, the up and down actions move the highlight by one entry and wrap at both
// ends." `specs/controls.md` binds `down` to `ArrowDown`, and
// `specs/instrumentation.md` reports the highlight as `menuIndex`, counted
// from `0`.
//
// THE STEP AND THE WRAP ARE TWO POINTS. A build whose highlight moves but never
// wraps and a build whose menu keys do nothing at all must not grade the same, and
// the wrap is an edge case of the stepping rule, which earns a check of its own.
// So `menu-down-moves` decides the step and `menu-down-wraps` decides the
// boundary.
//
// THE MENU IT IS DECIDED ON is the map select, because `specs/ui.md` gives it four
// entries — three maps and a `BACK` — so a step of one and a wrap to the first are
// different answers, which they would not be on a two-entry menu. The key is
// pressed as a player presses it, a real browser key event through the
// build's own keyboard layer. The entry count is read off the build's
// own `menuButtons`, so no layout and no fixed number of maps is assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps to the first entry from the last", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "mapselect");
  assertGreaterThanOrEqual(
    entries.length,
    2,
    "the map select to present more than one entry, so wrapping to the far end " +
      "is a different answer from standing still (specs/ui.md)",
  );

  await h.debug.setMenuIndex(entries.length - 1);
  await h.tap(keyFor("down"));
  await captureStill(h, "wrap");
  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    `the highlight after ${keyFor("down")} from the last of ${entries.length} ` +
      "entries, which wraps to the first (specs/ui.md)",
  );
});

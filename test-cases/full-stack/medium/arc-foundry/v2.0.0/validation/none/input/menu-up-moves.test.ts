// input/menu-up-moves — the up action moves the menu highlight up by one entry.
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

/** The entry the step is measured from: neither end of the menu. */
const MIDDLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight up one entry", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "mapselect");
  assertGreaterThanOrEqual(
    entries.length,
    MIDDLE + 1,
    "the map select to present its three maps and a BACK choice, so it has an " +
      "entry that is neither the first nor the last (specs/ui.md)",
  );

  await h.debug.setMenuIndex(MIDDLE);
  await h.tap(keyFor("up"));
  await captureStill(h, "wrap");
  assertEqual(
    (await h.snapshot()).menuIndex,
    MIDDLE - 1,
    `the highlight after ${keyFor("up")} from entry ${MIDDLE}, which moves it ` +
      "up by one (specs/ui.md)",
  );
});

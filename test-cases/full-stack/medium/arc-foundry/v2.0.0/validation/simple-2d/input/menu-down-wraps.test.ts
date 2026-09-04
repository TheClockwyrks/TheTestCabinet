// input/menu-down-wraps — the down action moves the menu highlight down, and wraps.
//
// THE REQUIREMENT. `specs/ui.md` states it for every menu at once: "On every
// menu, the up and down actions move the highlight by one entry and wrap at both
// ends." `specs/controls.md` binds `down` to `ArrowDown`, and
// `specs/instrumentation.md` reports the highlight as `menuIndex`, counted
// from `0`.
//
// HOW IT IS DECIDED. The map select is the menu it is decided on, because
// `specs/ui.md` gives it four entries — three maps and a `BACK` — so a step of one
// and a wrap to the first are different answers, which they would not be on a
// two-entry menu. The highlight is posed at a middle entry and the key is pressed
// as a player presses it, a real key event dispatched at the engine's own surface;
// the highlight is then posed at the last entry and the key pressed again, which
// is the wrap. The entry count is read off the build's own `menuButtons`, so no
// layout and no fixed number of maps is assumed.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openMenu,
  pressAction,
  type Harness,
} from "../harness";

/** The entry the step is measured from: neither end of the menu. */
const MIDDLE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the highlight down one entry, and wraps to the first from the last", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  assertGreaterThanOrEqual(
    entries.length,
    MIDDLE + 2,
    "the map select to present its three maps and a BACK choice, so it has an " +
      "entry that is neither the first nor the last (specs/ui.md)",
  );

  // One step down, from an entry with room below it.
  h.debug.setMenuIndex(MIDDLE);
  await pressAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    MIDDLE + 1,
    `the highlight after ${keyFor("down")} from entry ${MIDDLE}, which moves ` +
      "it down by one (specs/ui.md)",
  );

  // And the wrap: from the last entry it goes back to the first.
  h.debug.setMenuIndex(entries.length - 1);
  await pressAction(h, "down");
  captureStill(h, "wrap");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    `the highlight after ${keyFor("down")} from the last of ${entries.length} ` +
      "entries, which wraps to the first (specs/ui.md)",
  );
});

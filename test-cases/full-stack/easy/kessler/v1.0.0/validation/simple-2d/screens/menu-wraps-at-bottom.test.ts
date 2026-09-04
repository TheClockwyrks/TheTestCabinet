// screens/menu-wraps-at-bottom — the menu highlight wraps past the bottom.
//
// specs/screens.md, on menus: "`up` moves the highlight up one entry and
// `down` moves it down one, each wrapping past the end to the other." This
// point decides the downward wrap, on the title menu.
//
// The surface has no menu-index pose, so the last entry is reached with one
// real press, and that press is asserted as a precondition so a broken `down`
// fails by that name here rather than masquerading as a wrap fault.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS, TITLE_ITEMS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The key specs/controls.md binds to `down`. */
const DOWN = KEYS.down[0];

/** The title menu's last entry. */
const LAST = TITLE_ITEMS.length - 1;

it("wraps the highlight past the bottom to entry 0", async () => {
  h.reset();
  const booted = h.snapshot();
  assertEqual(
    booted.screen,
    "title",
    "the menu-bearing screen the wrap is read on",
  );

  await tap(h, DOWN);
  const onLast = h.snapshot();
  assertEqual(
    onLast.menu.index,
    LAST,
    "the last entry, reached before the wrapping press",
  );

  await tap(h, DOWN);
  captureStill(h, "wrapped");

  const after = h.snapshot();
  assertEqual(
    after.menu.index,
    0,
    "the highlight after down on the last entry",
  );
});

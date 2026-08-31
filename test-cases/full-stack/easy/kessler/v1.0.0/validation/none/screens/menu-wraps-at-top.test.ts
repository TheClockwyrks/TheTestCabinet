// screens/menu-wraps-at-top — the menu highlight wraps past the top.
//
// specs/screens.md, on menus: "`up` moves the highlight up one entry and
// `down` moves it down one, each wrapping past the end to the other." This
// point decides the upward wrap, on the title menu, from the entry the boot
// state highlights: entry 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_MENU } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The key specs/controls.md binds to `up`. */
const UP = BINDINGS.up[0];

/** The title menu's last entry. */
const LAST = TITLE_MENU.length - 1;

it("wraps the highlight past the top to the last entry", async () => {
  await h.reset();
  const booted = await h.snapshot();
  assertEqual(
    booted.screen,
    "title",
    "the menu-bearing screen the wrap is read on",
  );
  assertEqual(
    booted.menu.index,
    0,
    "the top entry the wrapping press is made on",
  );

  await tap(h, UP);
  await captureStill(h, "wrapped");

  const after = await h.snapshot();
  assertEqual(after.menu.index, LAST, "the highlight after up on entry 0");
});

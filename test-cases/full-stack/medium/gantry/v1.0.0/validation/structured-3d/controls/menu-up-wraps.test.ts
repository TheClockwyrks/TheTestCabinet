// controls/menu-up-wraps — `up` moves the menu highlight by one entry and wraps
// at the start.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the highlight
// by one entry and wrap at both ends". `specs/controls.md` § The actions binds
// `up` to `ArrowUp` and gives it "menu navigation".
//
// THE FIRST ENTRY IS WHERE THE WRAP LIVES, and it is where the title menu opens:
// `specs/ui.md` § Title gives the menu as `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`)
// "with `menuIndex` `0` on arriving", so one press of `up` is the wrap off the
// start and reads the last entry, `1`. A build that clamps at `0` — the ordinary
// way to get this wrong — leaves the highlight where it was, and a build that
// runs the index below zero leaves it somewhere no entry stands.
//
// ONE PRESS, BECAUSE ONE PRESS IS THE REQUIREMENT: `up` moving by one from an
// interior entry is the same rule read where it cannot fail, and the wrap at the
// end belongs to `down` (`controls/menu-down-wraps`).
//
// Nothing is posed on the way: the harness's opening `reset` leaves "the `title`
// screen with `menuIndex` `0`" (`specs/instrumentation.md`), which is the state
// this scenario needs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `up` action's binding, as `specs/controls.md` fixes it. */
const UP = BINDINGS.up[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the title menu's highlight to the last entry", async () => {
  const opening = await h.snapshot();
  assertEqual(opening.screen, "title", "the menu screen the press lands on");
  assertEqual(opening.menuIndex, 0, "the entry the title menu opens on");
  assertEqual(
    TITLE_ITEMS.length,
    2,
    "the entries the title menu carries (specs/ui.md § Title)",
  );

  await h.press(UP);

  assertEqual(
    (await h.snapshot()).menuIndex,
    TITLE_ITEMS.length - 1,
    `menuIndex after ${UP} on the first entry of a menu of ` +
      `${TITLE_ITEMS.length}, which moves the highlight by one and wraps at ` +
      "both ends (specs/ui.md § The screens)",
  );

  await h.advance(1);
  await h.capture("state", "the title menu after up wrapped off its start");
});

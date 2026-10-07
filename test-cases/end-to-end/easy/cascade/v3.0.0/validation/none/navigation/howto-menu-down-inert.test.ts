// navigation/howto-menu-down-inert — `menu-down` does nothing on the how-to
// screen.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `howto` /
// `menu-up`, `menu-down` — "Nothing. The screen carries one item, so `menuIndex`
// stays `0`." `specs/screens.md` says the same from the other side: "It is the
// screen's only item, so `menuIndex` is `0` throughout."
//
// WHY AN INERT ACTION IS GRADED AT ALL. A build that moves a one-item menu is
// pointing at nothing: `menuItemRect` answers `null` for any index but `0`
// (`specs/instrumentation.md`), so the selected item is drawn nowhere and the
// confirm that follows has nothing to activate. That affects play without taking
// a route away, which is what its `passable` cap says.
//
// ONE ACTION, ONE POINT. `navigation/howto-menu-up-inert` is the other
// direction: a build that clamps one and wraps the other is as ordinary a mistake
// as one that moves both, and bundled the two would score the same.
//
// A KEY BOUND TO TWO CODES IS ONE POINT. `specs/controls.md` binds `menu-down`
// to `ArrowDown` and `KeyS`: the two raise the same action and exercise the same rule the same
// way, so both are driven here from the same posed screen and a build that bound
// only one of the pair fails.
//
// THE SCREEN IS READ AS WELL, because a build that treated a movement key as a
// confirm would leave the screen and pass a check that read the index alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_BACK_ITEM, MENU_DOWN_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the single item selected on either down key", async () => {
  const read: { code: string; index: number; screen: string }[] = [];
  for (const code of MENU_DOWN_KEYS) {
    // Each key is driven from the same posed screen, so the second reading is
    // not of a selection the first one moved.
    await openHowto(h);
    assertEqual(
      (await h.snapshot()).menuIndex,
      HOWTO_BACK_ITEM,
      `posing: menuIndex before the press of ${code} — reset leaves it 0 ` +
        `(specs/instrumentation.md), which is the screen's only item`,
    );

    await h.tap(code);
    const after = await h.snapshot();
    read.push({ code, index: after.menuIndex, screen: after.screen });
  }

  await h.advance(1);
  await captureStill(h, "howto");

  for (const step of read) {
    assertEqual(
      step.index,
      HOWTO_BACK_ITEM,
      `menuIndex after one press of ${step.code} on the how-to screen — the ` +
        `screen carries one item, so menuIndex stays 0 (specs/controls.md)`,
    );
    assertEqual(
      step.screen,
      "howto",
      `the screen that press left, which a movement action does not change ` +
        `(specs/controls.md)`,
    );
  }
});

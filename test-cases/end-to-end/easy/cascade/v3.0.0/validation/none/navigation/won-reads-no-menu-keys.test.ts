// navigation/won-reads-no-menu-keys — the won screen reads none of the four menu
// actions.
//
// THE RULE. `specs/controls.md`, Menu navigation, immediately after the
// per-screen table: "`won` shows no menu and reads none of the four."
// `specs/screens.md` gives `won` no controls, and `specs/instrumentation.md` has
// `menuItemRect` answer `null` there.
//
// WHY IT IS GRADED. `specs/victory.md` has "A press anywhere, during the cascade
// or after it, deal a fresh game and move to the `playing` screen", and
// `specs/controls.md` defines a press as "a mouse button going down or a finger
// touching down". A build that read a KEY as that press too would deal a fresh
// game the moment a player rested a hand on the keyboard while the cascade
// played, which is exactly the deviation the sentence above rules out and which
// no other point can see.
//
// ALL SEVEN CODES ARE DRIVEN, one per key `specs/controls.md` binds, because they
// exercise the same rule the same way: none of them is read on this screen. The
// failure names the code that was.
//
// THE SCREEN IS WHAT IS READ. `won` is where every one of the four would have an
// effect if it were read at all — `menu-confirm` and `menu-back` activate, and
// the two movements select — so a screen that is still `won` after each press is
// what says none of them was.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MENU_BACK_KEY,
  MENU_CONFIRM_KEYS,
  MENU_DOWN_KEYS,
  MENU_UP_KEYS,
} from "../constants";
import { captureStill, createHarness, openWon, type Harness } from "../harness";

/** Every code `specs/controls.md` binds one of the four menu actions to. */
const CODES = [
  ...MENU_UP_KEYS,
  ...MENU_DOWN_KEYS,
  ...MENU_CONFIRM_KEYS,
  MENU_BACK_KEY,
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stays on won through every key the four menu actions are bound to", async () => {
  const read: { code: string; screen: string }[] = [];
  for (const code of CODES) {
    // Each code is driven from the same posed screen, so a build that left won on
    // the first is still asked about the rest.
    await openWon(h);
    assertEqual(
      (await h.snapshot()).screen,
      "won",
      `posing: the screen before the press of ${code} — a press made anywhere ` +
        `else says nothing about what won reads`,
    );

    await h.tap(code);
    read.push({ code, screen: (await h.snapshot()).screen });
  }

  await h.advance(1);
  // Before the assertions, so a build that left the screen still leaves the
  // picture of what it went to.
  await captureStill(h, "won");

  for (const step of read) {
    assertEqual(
      step.screen,
      "won",
      `the screen one press of ${step.code} left — won shows no menu and ` +
        `reads none of the four (specs/controls.md)`,
    );
  }
});

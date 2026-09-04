// screens/mode-select-back — BACK on the mode choice returns to the title with
// nothing started.
//
// specs/ui.md: on `mode-select`, "`BACK` returns to `title`". `BACK` is the third
// entry of `MODE_ITEMS`, and taking it must leave the session exactly where it
// was: no expedition has begun, so nothing has been generated, spent or reset.
//
// "NOTHING STARTED" IS READ, not assumed. A distinctive Credits balance is posed
// before the mode choice is opened, and read back after the return: beginning an
// expedition puts the Credits back to `0` (specs/gameplay.md), so a build that
// started one on the way out is caught on the balance rather than on the screen
// it landed on.
//
// ISOLATION. The mode choice reached directly through the surface rather than
// through the title, because a build with a broken title menu and a working BACK
// must pass this and fail that one.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** A balance no fresh expedition opens at, so a restart would be visible. */
const CREDITS = 815;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the mode choice without starting anything", async () => {
  h.debug.reset();
  h.debug.setCredits(CREDITS);
  h.debug.setScreen("mode-select");

  h.debug.setMenuIndex(MODE_ITEMS.indexOf("BACK"));
  await h.tap(ACTION_KEY.activate);

  const back = h.snapshot();
  captureStill(h, "back");
  assertEqual(
    back.screen,
    "title",
    "specs/ui.md: BACK on mode-select returns to the title",
  );
  assertEqual(
    back.credits,
    CREDITS,
    "specs/ui.md: BACK starts nothing, so no expedition has reset the Credits",
  );
});

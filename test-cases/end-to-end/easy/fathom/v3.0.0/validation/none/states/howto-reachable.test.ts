// states/howto-reachable — HOW TO PLAY confirmed on the title opens the screen.
//
// specs/ui.md's transition table: `"title"` + `HOW TO PLAY` confirmed ->
// `"howto"`. One edge, in one direction, and the whole of what this point
// decides — WHAT the screen covers is `states.howto-covers-the-game`, and the two
// ways back out are `states.howto-return-confirm` and
// `states.howto-return-back`.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `HOW TO PLAY` (specs/instrumentation.md) and one `confirm` takes it: which key
// moves a selection is `controls`' point, and a build with a broken `down` action
// must still pass this one.
//
// Nothing advances on `"title"` or on `"howto"` (specs/ui.md), so no bystander
// can move under the press and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the how-to screen from the title menu", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the confirm is made on");
  assertEqual(posed.menuIndex, HOWTO, "the posed title selection");

  await h.tap(CONFIRM_KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen HOW TO PLAY confirmed on the title menu reaches (specs/ui.md)",
  );
});

// Refract — screens/title-howto: confirming HOW TO PLAY on the title opens the
// how-to screen.
//
// specs/ui.md's table for `confirm` on the title: the HOW TO PLAY item sets
// `screen = howto` and `menuIndex = 0`. HOW TO PLAY is TITLE_ITEMS[2], and the
// highlight is POSED onto it with `setMenuIndex` rather than stepped to, so a
// build whose menu stepping is broken fails `screens/title-down` alone. The
// confirm itself is a real key event through the build's own bindings, because
// the confirm is what this point decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirming HOW TO PLAY sets screen to howto with menuIndex 0", async () => {
  await resetTo(h);
  h.debug.setMenuIndex(2);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "posing: the highlight sits on HOW TO PLAY (TITLE_ITEMS[2], specs/ui.md)",
  );

  await tapAction(h, "confirm");
  captureStill(h, "howto");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "howto",
    "confirming HOW TO PLAY sets screen to howto (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    0,
    "confirming HOW TO PLAY sets menuIndex to 0 (specs/ui.md)",
  );
});

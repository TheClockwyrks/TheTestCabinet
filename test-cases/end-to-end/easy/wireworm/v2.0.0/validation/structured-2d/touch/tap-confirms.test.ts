// Wireworm — touch/tap-confirms: a contact that lifts where it landed confirms
// it.
//
// specs/ui.md, "Pointer and touch on the menus": "A touch contact lands and
// lifts inside one item's region" makes `menuIndex` that item's index AND
// confirms it, with the effect that file's table for the screen gives `confirm`.
// On the title, `HOW TO PLAY` moves the game to `howto`.
//
// The tap is on the SECOND entry from a title posed on the first, so the screen
// that follows says which item the gesture confirmed: a build that confirmed
// whatever was already at `menuIndex` would open a run, and a build that never
// read the contact would still be on the title. That is what makes `screen` the
// whole reading here.
//
// Both edges carry the device a finger carries and are aimed at the region the
// build reports through `menuItemRect` (specs/instrumentation.md). No key is
// pressed: a build whose keyboard confirm is broken still has its finger graded
// here, and one whose finger is broken fails this and keeps
// `screens/title-howto`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  touchItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DESCEND = TITLE_ITEMS.indexOf("DESCEND");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms the item a touch contact lands and lifts in", async () => {
  resetTo(h);
  h.debug.setMenuIndex(DESCEND);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  touchItem(h, HOWTO);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen a tap inside HOW TO PLAY's region confirms to (specs/ui.md)",
  );
});

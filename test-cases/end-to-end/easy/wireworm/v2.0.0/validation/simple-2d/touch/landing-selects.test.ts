// Wireworm — touch/landing-selects: a contact landing on an item selects it.
//
// specs/ui.md, "Pointer and touch on the menus": "A touch contact lands inside
// an item's region, or travels onto one" makes `menuIndex` that item's index. A
// finger never hovers, so the landing is the first the build hears of it — which
// is why a landing selects where a mouse would first have had to move, and why
// this is a point of its own beside the pointer's.
//
// THE CONTACT IS LANDED AND LEFT DOWN. A confirm takes both of its edges inside
// one region, and the lift is the second of them, so a gesture that stops at the
// landing is the one that isolates the selection: what is read back is
// `menuIndex` alone, and `touch/tap-confirms` grades the lift.
//
// The title is posed with the highlight on `DESCEND`, so the selection this
// reads is one the landing had to move rather than one it inherited. The contact
// carries the device a finger carries and is aimed at the region the build
// reports through `menuItemRect` (specs/instrumentation.md), so a build that
// lays its menu out any way it likes is graded on what it does with the contact
// rather than on where it drew the words.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  menuItemCenter,
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

it("selects the item a touch contact lands on", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(DESCEND);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  const at = menuItemCenter(h, HOWTO);
  await h.pressPointer(at.x, at.y, { device: "touch" });
  captureStill(h, "selected");

  assertEqual(
    h.snapshot().menuIndex,
    HOWTO,
    "the item the contact landed on is selected (specs/ui.md)",
  );
});

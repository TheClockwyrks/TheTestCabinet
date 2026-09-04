// Spectra — touch/landing-selects: a contact selects the item it lands on.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A touch contact lands inside an
// item's region, or travels onto one" makes `menuIndex` that item's index. A finger
// is not a small mouse — it never hovers — so the first the build hears of it is the
// LANDING, and the landing is what selects.
//
// THE CONTACT IS LEFT DOWN, so no lift can confirm and the reading is the selection
// alone. `pointer/hover-selects` decides the mouse's own move, and
// `touch/tap-confirms` the confirm a lift makes.
//
// THE GROUND IS POSED. `reset` leaves the title with the highlight on the first item
// (`specs/instrumentation.md`), and the contact lands on the second, so the index
// read back can have come from nowhere but the finger.
//
// WHERE THE ITEM IS, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the contact lands in the middle of
// it, so any layout passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  landOnItem,
  liftContact,
  type Harness,
} from "../harness";

/**
 * The title menu's entries, by index.
 *
 * `specs/ui.md` fixes `TITLE_ITEMS` as "The mode entry `specs/mode.md` names,
 * then `HOW TO PLAY`, in that order", so the mode entry is `0` and how-to-play is
 * `1` whichever mode this build ships.
 */
const MODE_ENTRY = 0;
const HOWTO_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  // The contact is left down by the check, so it is lifted before the page goes.
  await liftContact(h);
  await h.dispose();
});

it("selects the title item a touch contact lands on", async () => {
  await h.debug.reset();
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the game opens on the title");
  assertEqual(posed.menuIndex, MODE_ENTRY, "with its first item highlighted");

  await landOnItem(h, HOWTO_ENTRY);
  await captureStill(h, "selected");

  const landed = await h.snapshot();
  assertEqual(
    landed.menuIndex,
    HOWTO_ENTRY,
    "menuIndex after a contact landed inside the second item's own region " +
      "(specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    landed.screen,
    "title",
    "the screen a landing alone reaches: the contact has not lifted, so " +
      "nothing is confirmed (specs/ui.md)",
  );
});

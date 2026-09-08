// Carom — touch/drag-cancels: a contact that lifts on another item confirms
// nothing.
//
// specs/ui.md: a confirm requires both of its edges inside ONE item's region, and
// "two edges that fall in different regions ... confirm no item". The same
// paragraph makes a contact that "travels onto" an item select it. So the one
// gesture the spec fixes here is a finger that lands on one entry, slides onto
// another and lifts: the selection follows to where it lifted, and nothing is
// confirmed. That is the affordance that lets a player who touched the wrong
// entry slide off it rather than be committed by the landing.
//
// BOTH READINGS ARE THE ONE BEHAVIOUR, and each carries the other. `screen` is
// the requirement — still `title`, because no item was confirmed. `menuIndex` is
// what makes that reading mean something: a build that ignored the contact
// altogether would also have left the screen alone, and the selection sitting at
// the entry the finger lifted over is the evidence the gesture was read at all.
//
// The slide runs from the FIRST entry to the third, so the confirm this must not
// make is the loudest one on the screen — `SOLO`, which would open a countdown —
// and the selection it must make is one the landing did not already hold.
//
// The landing, the travel and the lift are driven over separate frames so each
// is read, and all three carry `pointerType: "touch"` and the button the contact
// holds, exactly as a browser reports them, so the engine keeps them as one
// finger. `openTitle` advances one frame after the reset, so the landing is read
// by the title the reset settled on, and nothing on the field is posed or
// removed: specs/ui.md advances nothing on the title.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dragBetweenMenuItems,
  openTitle,
  type Harness,
} from "../harness";

const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the contact lifts on a different item", async () => {
  await openTitle(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await dragBetweenMenuItems(h, SOLO, HOWTO, { device: "touch" });
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(after.screen, "title");
  assertEqual(after.menuIndex, HOWTO);
});

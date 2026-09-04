// touch/drag-cancels — a contact that lifts on another item confirms nothing.
//
// specs/ui.md: a confirm takes both of its edges inside ONE item's region, and
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
// altogether would also have left the screen alone, and the selection at the
// entry the finger lifted over is the evidence the gesture was read at all.
//
// The slide runs from the FIRST entry to the third, so the confirm this must not
// make is the loudest one on the screen — `SOLO`, which would open a countdown
// — and the selection this must make is one the landing did not already hold.
//
// Three real touch events through Chromium's own input pipeline, over the
// regions the build reports; the still is the title the gesture left standing.
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title, so no bystander can move under the gesture.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  touchBetweenItems,
  type Harness,
} from "../harness";

const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the contact lifts on a different item", async () => {
  await openTitle(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await touchBetweenItems(h, SOLO, HOWTO);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(after.screen, "title");
  assertEqual(after.menuIndex, HOWTO);
});

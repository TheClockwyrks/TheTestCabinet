// touch/landing-selects — a contact selects the item it lands on.
//
// specs/ui.md, "Pointer and touch": "A touch contact lands inside an item's
// region" makes "that item ... the selected one". A finger never hovers, so the
// landing is the first the build hears of it — which is why a landing selects
// where a mouse would have had to move first, and why this is a point of its own
// beside the click.
//
// THE CONTACT IS LANDED AND LEFT DOWN. A confirm takes both of its edges inside
// one region and the lift is the second of them, so a gesture that stops at the
// landing is the one gesture that isolates the selection: what is read back is
// `menuIndex` alone, and `touch/tap-confirms` grades the lift.
//
// The title is reached by `reset`, which puts `menuIndex` at `0`
// (specs/instrumentation.md), so the selection this reads is one the landing had
// to move rather than one it inherited. The contact is a real one, landed at the
// region the build reports through `menuItemRect`, so a build that lays its menu
// out any way it likes is graded on what it does with the contact and not on
// where it drew the words.
//
// Nothing advances on `"title"` (specs/ui.md), so there is no bystander that
// could move under the gesture.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  touchOntoItem,
  type Harness,
} from "../harness";

/** The title entry the contact lands on: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item a touch contact lands on", async () => {
  await openTitle(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the contact lands on");
  assertEqual(posed.menuIndex, 0, "the selection a reset leaves the title on");

  await touchOntoItem(h, HOWTO);
  // Before the assertion, so a failing check still leaves the menu it read.
  await captureStill(h, "selected");

  assertEqual(
    (await h.snapshot()).menuIndex,
    HOWTO,
    "the title's selection after a contact landed in the region " +
      "menuItemRect reports for HOW TO PLAY, with no lift to confirm it " +
      "(specs/ui.md)",
  );
});

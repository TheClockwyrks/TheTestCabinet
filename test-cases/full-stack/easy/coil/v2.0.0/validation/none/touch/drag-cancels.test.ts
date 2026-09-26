// touch/drag-cancels — a contact that lifts on a different item confirms
// nothing.
//
// specs/ui.md, "Pointer and touch": "A confirm requires both of its edges inside one
// item's region: ... the landing and the lift for a touch contact. Two edges that
// fall in different regions ... confirm no item." The same paragraph gives the
// travel its own effect: a contact that "travels onto" an item's region makes
// `menuIndex` that item's index. So both are read — the screen stayed, and the
// selection followed the finger.
//
// The contact lands on the mode's entry and lifts on `HOW TO PLAY`, so a build
// that confirms on either edge leaves the title — for `playing` if it confirmed
// the landing, and for `howto` if it confirmed the lift.
//
// WHERE the item is drawn is the build's own. specs/ui.md leaves the layout of a
// menu to the build and fixes only that each item occupies a region and that a
// pointer over that region selects it, so the region comes from `menuItemRect`
// (specs/instrumentation.md) and the device is driven to its middle. A build that
// lays its menu out any way it likes passes, and one that reports a region it
// does not answer on fails.
//
// The title is opened by a reset and the selection posed with `setMenuIndex`,
// which is the precondition this point names; the only thing driven after that is
// the device, so what is read back can have come from nowhere else. Walking the
// arrows to the item would fail this point for a broken down edge, which is
// `controls/menu-highlight-moves`'s to report.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_INDEX } from "../constants";
import {
  captureStill,
  createHarness,
  dragOffMenuItems,
  openTitle,
  type Harness,
} from "../harness";

/** The mode's entry, which specs/ui.md makes the first item of the title menu. */
const MODE_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the contact lifts on a different item", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(MODE_INDEX);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the gesture runs over");
  assertEqual(posed.menuIndex, MODE_INDEX, "the item the contact lands on");

  await dragOffMenuItems(h, MODE_INDEX, HOWTO_INDEX);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a landing and a lift in different items left",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_INDEX,
    "the item the contact's travel selected",
  );
});

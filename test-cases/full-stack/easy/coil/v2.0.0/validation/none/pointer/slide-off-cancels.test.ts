// pointer/slide-off-cancels — a press and a release in different items confirms
// nothing.
//
// specs/ui.md, "Pointer and touch": "A confirm requires both of its edges inside one
// item's region: the press and its release for a pointer... Two edges that fall
// in different regions, and an edge that falls outside every region, confirm no
// item." This is the affordance that lets a player who pressed the wrong entry
// slide off it and let go, and a build without it confirms whatever the finger
// first touched.
//
// The press lands on `HOW TO PLAY` and the release on the mode's entry, so a
// build that confirms on either edge leaves the title — for `howto` if it
// confirmed the press, and for `playing` if it confirmed the release. Reading
// `screen` back at `title` rules out both.
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
  openTitle,
  slideOffMenuItems,
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

it("confirms nothing when the press and the release fall in different items", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(MODE_INDEX);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the gesture runs over");

  await slideOffMenuItems(h, HOWTO_INDEX, MODE_INDEX);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen a press and a release in different items left",
  );
});

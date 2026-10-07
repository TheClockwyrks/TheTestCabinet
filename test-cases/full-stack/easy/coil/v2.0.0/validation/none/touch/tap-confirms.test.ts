// touch/tap-confirms — a contact that lifts where it landed confirms that item.
//
// specs/ui.md, "Pointer and touch": "A touch contact lands and lifts inside one
// item's region" makes `menuIndex` "that item's index, and that item is
// confirmed", and "the effect is the one that screen carries for `confirm`".
// specs/ui.md's `title` table gives that effect for `HOW TO PLAY`: "`confirm` on
// `HOW TO PLAY` sets `screen` to `howto`." The landing on its own is
// `touch/landing-selects`.
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
  tapMenuItem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the item a touch contact lands and lifts in", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(0);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the contact lands on");
  assertEqual(posed.menuIndex, 0, "the highlighted item before the contact");

  await tapMenuItem(h, HOWTO_INDEX);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen a tap on HOW TO PLAY opened",
  );
});

// touch/tap-confirms — a contact that lifts where it landed confirms that item.
//
// specs/ui.md: "A touch contact lands and lifts inside one item's region" makes
// `menuIndex` that item's index AND confirms it, and the effect of the confirm
// is the one the keyboard table gives `confirm` on that screen — on the title,
// `HOW TO PLAY` sets `screen = howto`.
//
// The tap is on the THIRD entry from a title `reset` leaves selected on the
// first, so the screen that follows says which item the gesture confirmed: a
// build that confirmed the item already at `menuIndex` would open a Solo
// countdown, and a build that never read the contact would still be on the
// title. That is what makes `screen` the whole reading here — `menuIndex` on
// arrival is `0` by the spec's own rule for entering the how-to screen, so the
// selection cannot be read back after the confirm and is
// `touch/landing-selects`'s point instead.
//
// Both edges are real touch events through Chromium's own input pipeline, landed
// and lifted at the region the build reports for the item, and no key is pressed
// — so a build whose keyboard confirm is broken still has its finger graded
// here, and a build whose finger is broken fails this and keeps
// `navigation/title-howto`.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on the how-to screen, so the gesture runs over a world that
// cannot move under it.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  tapItem,
  type Harness,
} from "../harness";

/** The title entry the contact taps: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the item a touch contact lands and lifts in", async () => {
  await openTitle(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 0);

  await tapItem(h, HOWTO);
  await captureStill(h, "howto");

  assertEqual((await h.snapshot()).screen, "howto");
});

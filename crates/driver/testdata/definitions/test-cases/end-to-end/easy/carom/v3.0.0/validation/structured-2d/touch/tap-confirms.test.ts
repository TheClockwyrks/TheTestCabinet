// Carom — touch/tap-confirms: a contact that lifts where it landed confirms it.
//
// specs/ui.md: "A touch contact lands and lifts inside one item's region" makes
// `menuIndex` that item's index AND confirms it, and the effect of the confirm
// is the one the keyboard table gives `confirm` on that screen — on the title,
// `HOW TO PLAY` sets `screen = howto`. The two edges arrive on one frame, which
// the same section says confirms.
//
// The tap is on the THIRD entry from a title `reset()` leaves selected on the
// first, so the screen that follows says which item the gesture confirmed: a
// build that confirmed whatever was already at `menuIndex` would open a Solo
// countdown, and a build that never read the contact would still be on the
// title. That is what makes `screen` the whole reading here — specs/ui.md fixes
// `menuIndex` at `0` on arrival at the how-to screen, so the selection cannot be
// read back after the confirm and is `touch/landing-selects`'s point instead.
//
// Both edges carry `pointerType: "touch"`, dispatched at the target the engine
// listens on and aimed at the region the build reports through `menuItemRect`.
// No key is pressed: a build whose keyboard confirm is broken still has its
// finger graded here, and one whose finger is broken fails this and keeps
// `navigation/title-howto`. `openTitle` advances one frame after the reset, so
// the tap is read by the title the reset settled on.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on the how-to screen, so this transition runs over a world
// that cannot move under it either way.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  touchMenuItem,
  type Harness,
} from "../harness";

/** The title entry the contact taps: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms the item a touch contact lands and lifts in", async () => {
  await openTitle(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 0);

  await touchMenuItem(h, HOWTO);
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");
});

// screens/levelup-copy — the level-up overlay draws its heading.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "An overlay over
// the world, which stays drawn beneath it exactly as the tick that opened the
// overlay left it. It shows `LEVEL_UP_TEXT` (`THE LAMP BURNS BRIGHTER`) and the
// offers in `offers`". `LEVEL_UP_TEXT` is that copy. What the overlay lists
// beneath the heading is `levelup-lists-offers`.
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is reached the real way: an
// isolated night with a level-up queued, and the tick that ends with it queued
// opens the overlay, as specs/progression.md states ("A `playing` tick that
// ends with `pendingLevelUps` above `0` runs to completion and then opens the
// overlay"). The offers are queued through `setNextOffers` so the frame read is
// the one this check posed rather than a draw of the build's, and the screen is
// read back before the frame so that a build that opened nothing fails on the
// precondition.
//
// THE TOLERANCE. The heading is matched folded — lower-cased, with spaces,
// dashes and underscores removed, across consecutive runs of text — because
// specs/ui.md fixes "no palette, no font, no layout, and no styling" and a
// build is free to letter-space or wrap it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVEL_UP_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertShows, night, openOffers, shown } from "./stage";

/** Three candidates of an empty loadout's pool, one weapon and two others. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws THE LAMP BURNS BRIGHTER on the open overlay", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.screen, "levelup", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "overlay");

  assertShows(page, LEVEL_UP_TEXT, "the level-up overlay");
});

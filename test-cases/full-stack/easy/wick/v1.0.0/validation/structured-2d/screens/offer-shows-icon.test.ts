// Wick — screens/offer-shows-icon: each offer is listed with its item's
// produced icon.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`", the
// offer table: the Icon part is "The item's produced icon."
// `specs/assets.md` gives each of them its path, which this suite spells as
// `ICON_PATHS`, one file per offerable id.
//
// WHAT IS READ. Which produced FILE the frame blitted, off the bytes the
// harness served the loader — so a build that drew a shape of its own where an
// icon belongs, or reached for a file it never produced, fails. Where the icon
// sits and how large it is drawn are the build's (`specs/ui.md`,
// Presentation).
//
// THE DRIVE. An isolated `playing` run holding NOTHING, so the two icons read
// for cannot have come from a HUD slot: `specs/ui.md` draws a weapon or
// passive slot's icon only for an item that is held, and neither offered item
// is. Both are queued by name through `setNextOffers`, which
// `specs/instrumentation.md` says the overlay "then presents exactly that list
// in that order", and the overlay is opened by the one `playing` tick a
// pending level-up ends on.
//
// THE TOLERANCE. None: a file path either was blitted or was not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { ICON_PATHS, type OfferId } from "../constants";
import {
  blitsFrom,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** A weapon and a passive, neither of them held, both candidates of the pool. */
const OFFERS: readonly OfferId[] = ["ember", "tallow"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("blits the produced icon of each item it offers", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    OFFERS,
    "the offers the overlay presents",
  );
  assertLength(
    overlay.run.weapons,
    0,
    "the weapons held, none of them offered",
  );
  assertLength(
    overlay.run.passives,
    0,
    "the passives held, none of them offered",
  );

  const { blits } = await h.frameDraw();
  captureStill(h, "icons");

  for (const id of OFFERS) {
    assertGreaterThanOrEqual(
      blitsFrom(blits, ICON_PATHS[id]).length,
      1,
      `blits of ${ICON_PATHS[id]}, the offered item's produced icon (specs/ui.md, levelup)`,
    );
  }
});

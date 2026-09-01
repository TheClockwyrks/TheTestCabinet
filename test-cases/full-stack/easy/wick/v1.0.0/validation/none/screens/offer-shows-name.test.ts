// screens/offer-shows-name — each offer on the overlay shows its item's display
// name.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"), the offer table:
// "Name | The weapon's name from `WEAPON_NAMES`, the passive's from `PASSIVES`,
// or `LAMP_OIL_NAME` (`Lamp Oil`)." Those three are the whole of the rule, and
// this check reads one of each: a weapon offered, a passive offered, and the
// lamp oil an empty pool offers, "When the pool is empty the overlay offers
// exactly one item, `LAMP_OIL_ID`" (specs/progression.md).
//
// WHY THE WORLD IS POSED AS IT IS. Two overlays over one isolated night. The
// first is opened over an empty loadout, whose pool holds every weapon and
// every passive, with a weapon and a passive queued through `setNextOffers`.
// It is then closed through the surface's `choose`, which accepts an offer
// "exactly as moving the highlight there and pressing `confirm` would" —
// the route out, since what `confirm` does is `levelup-confirm-accepts`. The
// second is opened over a loadout of six weapons at `MAX_WEAPON_LEVEL` and six
// passives at their own maxes, which leaves no candidate: no held item below
// its max and no free slot to offer a new one, so the pool is empty and the
// overlay offers lamp oil alone.
//
// THE TOLERANCE. Each name is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — because
// specs/ui.md fixes no font and no layout, and a build may draw a name beside
// marks of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LAMP_OIL_ID, LAMP_OIL_NAME } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertShows,
  night,
  offerName,
  openLampOil,
  openOffers,
  shown,
} from "./stage";

/** A weapon and a passive, both candidates of an empty loadout's pool. */
const OFFERS = ["ember", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a weapon's name, a passive's name, and Lamp Oil on their offers", async () => {
  await night(h);
  await openOffers(h, OFFERS);

  const listed = await shown(h);
  await captureStill(h, "names");
  for (const id of OFFERS) {
    assertShows(listed, offerName(id), `the offer ${id}`);
  }

  await h.debug.choose(0);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "the screen the accepted offer left");
  await openLampOil(h);

  const fallback = await shown(h);
  assertShows(fallback, LAMP_OIL_NAME, `the offer ${LAMP_OIL_ID}`);
});

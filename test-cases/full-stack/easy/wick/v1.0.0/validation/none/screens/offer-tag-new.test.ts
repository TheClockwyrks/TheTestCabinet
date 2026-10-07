// screens/offer-tag-new — an offer for an item not held is tagged NEW.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"), the offer table:
// "Tag | `OFFER_NEW_TEXT` (`NEW`) for an item not yet held, else `LEVEL_LABEL`
// and the level it would become, as `LEVEL 3`. Lamp oil is never held, so its
// tag is `NEW`." specs/progression.md ("Choosing") states the same rule. So a
// weapon not held, a passive not held, and the lamp oil an empty pool offers
// all carry that tag; what a HELD item's offer carries is `offer-tag-level`.
//
// WHY THE WORLD IS POSED AS IT IS. Two overlays over one isolated night. The
// first is opened over an EMPTY loadout, so neither offered item is held and
// both must be tagged new, and the tag is looked for on each offer's own row
// rather than anywhere on the frame, so a build that tagged one of two passes
// nothing. The first overlay is closed through the surface's `choose`, which
// accepts "exactly as moving the highlight there and pressing `confirm` would".
// The second is opened over six weapons at `MAX_WEAPON_LEVEL` and six passives
// at their maxes, which leaves the pool empty, and "When the pool is empty the
// overlay offers exactly one item, `LAMP_OIL_ID`" (specs/progression.md).
//
// THE TOLERANCE. The tag is matched folded and counts as an offer's when it
// lands within `ROW_BAND` (`110` units) of that offer's name, the case's
// allowance for a layout specs/ui.md does not fix.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LAMP_OIL_ID, LAMP_OIL_NAME, OFFER_NEW_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertOnRow,
  mustRowY,
  night,
  offerName,
  openLampOil,
  openOffers,
  rowsShowing,
  shown,
} from "./stage";

/** A weapon and a passive, neither held, both candidates of an empty pool. */
const OFFERS = ["ember", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tags an unheld weapon, an unheld passive, and lamp oil NEW", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(
    (opened.run.weapons ?? []).length,
    0,
    "the weapons held when the offers were drawn",
  );
  assertEqual(
    (opened.run.passives ?? []).length,
    0,
    "the passives held when the offers were drawn",
  );

  const listed = await shown(h);
  await captureStill(h, "new");
  const tags = rowsShowing(listed, OFFER_NEW_TEXT);
  for (const id of OFFERS) {
    const row = mustRowY(listed, offerName(id), `the offer ${id}`);
    assertOnRow(tags, row, `the NEW tag of the offer ${id}`);
  }

  await h.debug.choose(0);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "the screen the accepted offer left");
  await openLampOil(h);

  const fallback = await shown(h);
  const oilRow = mustRowY(fallback, LAMP_OIL_NAME, `the offer ${LAMP_OIL_ID}`);
  assertOnRow(
    rowsShowing(fallback, OFFER_NEW_TEXT),
    oilRow,
    `the NEW tag of the offer ${LAMP_OIL_ID}`,
  );
});

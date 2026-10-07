// Wick — screens/offer-tag-new: an offer for something not held is tagged
// `NEW`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`", the
// offer table: the Tag is "`OFFER_NEW_TEXT` (`NEW`) for an item not yet held,
// else `LEVEL_LABEL` and the level it would become, as `LEVEL 3`. Lamp oil is
// never held, so its tag is `NEW`." `specs/progression.md`, "Choosing", says
// the same.
//
// THE DRIVE. Two overlays, one for each half of the rule. First an isolated
// `playing` run holding NOTHING, with a weapon and a passive queued through
// `setNextOffers`: neither is held, so BOTH tags are `NEW`, and a build that
// tags one offer and not the other fails on the count. Then an isolated run
// with every slot filled and maxed, whose empty pool draws the lamp-oil offer,
// whose tag is `NEW` though nothing about it was ever held.
//
// THE TOLERANCE. The tag is matched as a whole token among the runs of text
// the frame drew, ignoring case, so a build that draws `NEW` inside a line
// with the item's name reads the same as one that draws it alone; `NEW` inside
// a longer word does not count.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { LAMP_OIL_ID, OFFER_NEW_TEXT, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drawnTextLines,
  hasToken,
  isolate,
  openLevelUp,
  type DrawCall,
  type Harness,
} from "../harness";
import { fillEverySlot } from "./stage";

/** Two offers for items the run does not hold. */
const OFFERS: readonly OfferId[] = ["ember", "tallow"];

/** How many of `lines` carry `text` as a whole token. */
function carrying(lines: readonly string[], text: string): number {
  return lines.filter((line) => hasToken([line], text)).length;
}

/**
 * How many runs of drawn text carry `text` as a whole token: the larger count
 * over the raw calls and over the logical runs they spell, each a partition of
 * the same draws. The runs, so a tag drawn a glyph per call is one run carrying
 * it; the raw calls as well, so a tag drawn a narrow gap after its name, which
 * the run rule merges into `EmberNEW`, is still the call carrying it. A count
 * cannot read the two together, since a plain call would be counted twice.
 */
function tagged(calls: readonly DrawCall[], text: string): number {
  return Math.max(
    carrying(drawnText(calls), text),
    carrying(drawnTextLines(calls), text),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tags both unheld offers and the lamp-oil offer NEW", async () => {
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

  const { calls } = await h.frameDraw();
  captureStill(h, "new");
  assertGreaterThanOrEqual(
    tagged(calls, OFFER_NEW_TEXT),
    OFFERS.length,
    `runs of text carrying the ${OFFER_NEW_TEXT} tag, one per unheld offer (specs/ui.md, levelup)`,
  );

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers over an empty pool",
  );

  const second = await h.frameDraw();
  assertGreaterThanOrEqual(
    tagged(second.calls, OFFER_NEW_TEXT),
    1,
    `runs of text carrying the ${OFFER_NEW_TEXT} tag on the lamp-oil offer`,
  );
});

// progression/offers-drawn-at-random — the draw is random, so overlays opened
// over one pool ten times do not all present the same three ids in the same
// order.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "The overlay offers
// OFFER_COUNT distinct candidates drawn uniformly at random from the pool
// without replacement ... offers holds the drawn ids in the order they are
// listed", and the pool "is computed each time a level-up overlay opens, from
// the slots as they stand at that moment", so ten overlays over unchanged
// slots draw from one and the same pool.
//
// THE POSE. One isolated night with nothing on the field, nothing held, and
// every driver switch off, so the pool is the same twenty candidates every
// time. Each overlay is opened the real way, by queueing a level-up and
// running the playing tick that ends with it queued, read, and left through
// `setScreen("playing")`, which "Sets `screen` to `name` ... Nothing else
// changes", so no offer is accepted and the slots stand. Nothing is posed for
// the draw itself.
//
// THE TOLERANCE. The reading is that the ten are not all one list, not that any
// two draws differ: a build that happens to repeat a draw on two of the ten
// still passes. A build that offers a fixed three, the first three of the pool
// among them, presents one list ten times and fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** How many overlays the same pool is drawn over. */
const OVERLAYS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("does not present one list of three from all ten overlays", async () => {
  isolate(h);
  const drawn: string[] = [];
  for (let draw = 1; draw <= OVERLAYS; draw += 1) {
    const overlay = await openLevelUp(h, 1);

    assertEqual(
      overlay.screen,
      "levelup",
      `the overlay opened on draw ${draw}`,
    );
    assertEqual(
      overlay.run.offers.length,
      OFFER_COUNT,
      `three on draw ${draw}`,
    );
    drawn.push(overlay.run.offers.join(","));
    if (draw === OVERLAYS) captureStill(h, "random");
    h.debug.setScreen("playing");
  }

  assertGreaterThan(
    new Set(drawn).size,
    1,
    `the distinct draws over ten overlays (${drawn.join(" | ")})`,
  );
});

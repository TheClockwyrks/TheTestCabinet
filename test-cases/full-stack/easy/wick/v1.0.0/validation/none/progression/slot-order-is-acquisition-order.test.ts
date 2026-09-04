// progression/slot-order-is-acquisition-order — an item keeps its slot for the
// run.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Slots"): "An item
// enters the first free slot of its kind at level `1` AND KEEPS THAT SLOT FOR
// THE REST OF THE RUN, SO SLOT ORDER IS ACQUISITION ORDER", and "A run starts
// with Taper at level `1` in the first weapon slot". "Choosing" gives what a
// later acceptance does to a held item: "Its level rises by `1`", and nothing
// about where it sits. So Taper, then Ember, then Pin leaves the three in that
// order, and leveling Ember twice afterwards leaves the order untouched.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and the loadout a run starts with, Taper alone. Four level-ups
// are queued and each overlay's offer is fixed with `setNextOffers`, which
// "Applies on a run screen and on `levelup`, where the next overlay is the
// queued one" (specs/instrumentation.md), so the four acceptances are the two
// acquisitions and then the two levels rather than whatever the draw produced.
// Ember is the one leveled because it sits in the MIDDLE slot: a build that
// re-appends an item on a level, or that keeps its slots sorted by level, moves
// it away from the second slot, and a build that only ever appends new items
// passes on a loadout leveled at its end.
//
// THE TOLERANCE. None: the ids and their order are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/**
 * The four acceptances after the Taper a run starts with: two acquisitions in
 * order, then the middle slot's weapon leveled twice.
 */
const ACCEPTED: readonly OfferId[] = ["ember", "pin", "ember", "ember"];

/** The order the acquisitions fix, which nothing afterwards may change. */
const ORDER = ["taper", "ember", "pin"];

/** The level Ember stands at when the two levels have landed. */
const EMBER_LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps Taper, Ember, and Pin in acquisition order across two levels", async () => {
  await isolate(h, { taper: true });
  await h.debug.setNextOffers([ACCEPTED[0]!]);

  let overlay = await openLevelUp(h, ACCEPTED.length);
  for (const [index, offer] of ACCEPTED.entries()) {
    assertEqual(
      overlay.screen,
      "levelup",
      `the screen the overlay ${index + 1} stands on`,
    );
    assertDeepEqual(
      overlay.run.offers,
      [offer],
      `the offers overlay ${index + 1} presents`,
    );
    const next = ACCEPTED[index + 1];
    if (next !== undefined) await h.debug.setNextOffers([next]);
    await h.debug.choose(0);
    overlay = await h.snapshot();
  }
  await captureStill(h, "order");

  assertEqual(overlay.screen, "playing", "the screen the last acceptance left");
  assertDeepEqual(
    overlay.run.weapons.map((slot) => slot.id),
    ORDER,
    "the weapon slots in order after the four acceptances",
  );
  assertEqual(
    overlay.run.weapons[1]?.level,
    EMBER_LEVEL,
    "the level Ember stands at",
  );
});

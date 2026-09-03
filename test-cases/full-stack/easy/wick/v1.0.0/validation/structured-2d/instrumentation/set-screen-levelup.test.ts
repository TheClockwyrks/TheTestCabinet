// Wick — instrumentation/set-screen-levelup: on `playing` with one level-up
// queued, `setScreen('levelup')` opens the overlay exactly as the end of a
// `playing` tick does.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `levelup` from `playing` with `pendingLevelUps` at
// least 1: "Opens the overlay exactly as the end of a `playing` tick opens it:
// the pool is computed, `nextOffers` is consumed or the draw is made, and
// `offers` is filled", with `menuIndex` `0`; the `pool` row of the derived
// table orders the pool in `BASE_WEAPON_IDS` then `PASSIVE_IDS` order;
// `setNextOffers`: "the overlay then presents exactly that list in that
// order"; `specs/progression.md`, "The draw": `OFFER_COUNT` (3) distinct
// candidates from the pool.
//
// THE POSES. Two, on an isolated run holding nothing, whose pool is every
// base weapon then every passive: one with a queued list, which the overlay
// presents as given; one without, which draws three distinct candidates.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import {
  BASE_WEAPON_IDS,
  OFFER_COUNT,
  PASSIVE_IDS,
  type OfferId,
} from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The pool of an empty loadout with free slots: every base weapon, every passive. */
const EMPTY_LOADOUT_POOL: OfferId[] = [...BASE_WEAPON_IDS, ...PASSIVE_IDS];
const QUEUED: OfferId[] = ["shard", "tinder", "lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the overlay with the pool computed and offers from the queue or the draw", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(1);
  h.debug.setNextOffers(QUEUED);
  h.debug.setScreen("levelup");
  const queued = h.snapshot();
  await h.frameDraw();
  captureStill(h, "overlay");

  assertEqual(queued.screen, "levelup", "screen after setScreen('levelup')");
  assertEqual(queued.menuIndex, 0, "menuIndex after setScreen('levelup')");
  assertDeepEqual(
    queued.run.pool,
    EMPTY_LOADOUT_POOL,
    "run.pool on the opened overlay",
  );
  assertDeepEqual(queued.run.offers, QUEUED, "run.offers from the queued list");
  assertEqual(queued.run.nextOffers, null, "run.nextOffers once consumed");

  isolate(h);
  h.debug.setPendingLevelUps(1);
  h.debug.setScreen("levelup");
  const drawn = h.snapshot();
  assertEqual(
    drawn.screen,
    "levelup",
    "screen after the second setScreen('levelup')",
  );
  assertDeepEqual(
    drawn.run.pool,
    EMPTY_LOADOUT_POOL,
    "run.pool on the drawn overlay",
  );
  assertLength(drawn.run.offers, OFFER_COUNT, "run.offers drawn");
  assertLength(
    [...new Set(drawn.run.offers)],
    OFFER_COUNT,
    "distinct drawn offers",
  );
  for (const offer of drawn.run.offers) {
    assertContains(
      drawn.run.pool,
      offer,
      `drawn offer ${offer} within the pool`,
    );
  }
});

// Wick — instrumentation/snapshot-pool-on-levelup: on `levelup`, `pool` lists
// the candidate pool computed from the slots as they stand, ordered as the
// specification orders it, and `offers` is drawn from it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md`, the `pool` row: "on `levelup`, the candidate
//     pool of `specs/progression.md` computed from the slots as they stand,
//     each id once, in `BASE_WEAPON_IDS` order then `PASSIVE_IDS` order, so
//     `offers` is a subset of it".
//   - `specs/progression.md`, "The candidate pool": every held base weapon
//     below `MAX_WEAPON_LEVEL` and every held passive below its max; with a
//     weapon slot free, every base weapon not held whose evolution is not held;
//     with a passive slot free, every passive not held. "An evolved weapon is
//     never a candidate, and neither is the base weapon it came from."
//   - "The draw": `OFFER_COUNT` (3) distinct candidates from the pool.
//
// THE LOADOUT, chosen so every rule above has a case: Pyre at level 1 (evolved,
// so neither `pyre` nor `taper` is a candidate), Ember at 3 (held, below max,
// a `+1` candidate), Brass at 3 (its max, excluded), Oil at 2 (held, below
// max). Slots are free on both sides. The expected pool is computed from
// those rules over `BASE_WEAPON_IDS` and `PASSIVE_IDS` in `constants.ts`, and
// the overlay is opened by the real tick with one level-up queued.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import { BASE_WEAPON_IDS, OFFER_COUNT, PASSIVE_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The pool the rules give the loadout below, in the stated order. */
const EXPECTED_POOL = [
  // Taper is Pyre's base, and Pyre, evolved, is in no `BASE_WEAPON_IDS`.
  ...BASE_WEAPON_IDS.filter((id) => id !== "taper"),
  ...PASSIVE_IDS.filter((id) => id !== "brass"),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports the candidate pool in BASE_WEAPON_IDS then PASSIVE_IDS order, offers within it", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);
  holdWeapon(h, "ember", 3);
  holdPassive(h, "brass", 3);
  holdPassive(h, "oil", 2);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "pool");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertDeepEqual(overlay.run.pool, EXPECTED_POOL, "run.pool on levelup");
  assertLength(overlay.run.offers, OFFER_COUNT, "run.offers drawn");
  assertLength(
    [...new Set(overlay.run.offers)],
    OFFER_COUNT,
    "distinct ids among run.offers",
  );
  for (const offer of overlay.run.offers) {
    assertContains(overlay.run.pool, offer, `offer ${offer} within run.pool`);
  }
});

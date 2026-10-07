// Wick — evolutions/first-eligible-in-slot-order: one chest evolves the first
// eligible weapon in slot order and leaves the rest.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 1: "The held weapons are
//     checked in slot order, first slot first, and the first base weapon at
//     `MAX_WEAPON_LEVEL` whose recipe passive is held at any level evolves ...
//     One chest evolves at most one weapon."
//   - `specs/evolutions.md` ("The recipe"): Beacon comes from Ember with Oil,
//     and Pyre from Taper with Wick, so with Oil and Wick both held and both
//     bases at `MAX_WEAPON_LEVEL` both are eligible and slot order alone
//     decides.
//   - `specs/progression.md` ("Slots"): "An item enters the first free slot of
//     its kind ... so slot order is acquisition order", which is what
//     `setWeapon(slot, ...)` poses directly (`specs/instrumentation.md`).
//   - `specs/evolutions.md` ("Opening a chest"), rule 1: the evolved weapon
//     "replaces its base in the same slot with a single level".
//
// WHAT IS READ. After the collecting tick: slot 0 holds `beacon` at level `1`,
// slot 1 still holds `taper` at level `8`, and `chestResult` reads
// `{ kind: "evolve", weapon: "beacon" }`. A build that evolves both, or that
// evolves the later slot, fails on one of the three.
//
// WHY THE NIGHT IS POSED AS IT IS. Two maxed bases whose recipes are both
// satisfied, in a fixed slot order, and nothing else: no third weapon to be
// checked first, no enemy, and every driver switch off, so the tick that
// collects the chest changes nothing but what the chest decided.
//
// TOLERANCE. None: ids, whole levels, and a result object.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { EVOLUTIONS, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { assertSlotHolds, chestResult, poseChestNight } from "./chest";

/** The evolution of the first slot: Beacon, from Ember with Oil. */
const FIRST = "beacon";

/** The evolution of the second slot, which this chest must leave: Pyre. */
const SECOND = "pyre";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("evolves Ember in slot 0 into Beacon and leaves Taper at 8 in slot 1", async () => {
  poseChestNight(h);
  const first = holdWeapon(h, EVOLUTIONS[FIRST].from, MAX_WEAPON_LEVEL);
  const second = holdWeapon(h, EVOLUTIONS[SECOND].from, MAX_WEAPON_LEVEL);
  holdPassive(h, EVOLUTIONS[FIRST].passive, 1);
  holdPassive(h, EVOLUTIONS[SECOND].passive, 1);

  const after = await openChest(h);
  captureStill(h, "first");

  assertSlotHolds(after, first, FIRST, 1, "slot 0, the first eligible weapon");
  assertSlotHolds(
    after,
    second,
    EVOLUTIONS[SECOND].from,
    MAX_WEAPON_LEVEL,
    "slot 1, the second eligible weapon",
  );
  assertDeepEqual(
    chestResult(after, "the chest collected with two eligible weapons"),
    { kind: "evolve", weapon: FIRST },
    "the chest's result",
  );
});

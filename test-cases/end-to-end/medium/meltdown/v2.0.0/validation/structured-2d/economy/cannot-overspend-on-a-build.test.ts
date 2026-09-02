// Meltdown — economy/cannot-overspend-on-a-build: a footprint the money cannot
// cover reads invalid, builds nothing and spends nothing.
//
// `specs/building.md`'s validity list, condition 4: "The current money is at
// least the held type's build cost", and "A footprint that fails any one of them
// is invalid." Then: "Placing on an invalid footprint builds nothing, blocks
// nothing, and spends nothing." `specs/economy.md` states the same rule from the
// money's side: "a purchase the money on hand cannot cover does not happen at
// all, and nothing about the floor or the run changes when one is refused."
//
// THE MONEY IS ONE SHORT OF THE COST, which is the tightest case there is and the
// one a build is likeliest to have got wrong. The type is the Bloom, whose cost
// `specs/towers.md` gives as `150`, so the purse holds `149`.
//
// THE FOOTPRINT IS PROVED PLACEABLE FIRST, and without that this point would
// decide nothing. A build whose preview reads invalid everywhere, or which never
// builds anything at all, would pass a check that only ever looked at the
// unaffordable case. So the same footprint is armed twice: once with the cost
// exactly on hand, where `specs/building.md`'s "at least the held type's build
// cost" makes it valid, and once a single unit short. The first reading is this
// point's precondition — it says the five conditions that are not about money all
// hold here — and the second is its verdict.
//
// WHY THE FOOTPRINT SATISFIES THE OTHER FIVE. `(20, 12)` puts the Bloom's three
// tiles by three wholly on the grid, on open floor that `startRun` cleared of
// every tower and every unit, in Containment — the mode `specs/modes.md` leaves
// the whole floor buildable — and one 3x3 block in the middle of a 50x36 floor
// cannot come near sealing a route, so `specs/mazing.md`'s never-seal rule is
// satisfied.
//
// THE MONEY IS POSED BEFORE THE TYPE IS ARMED, so `build.valid` — which
// `specs/building.md` defines as whether the footprint "could be placed right
// now" — is computed with the purse this point means to present it with, however
// a build chooses to keep that flag current.
//
// THREE THINGS ARE READ, BECAUSE THE RULE IS THREE THINGS: the preview reads
// invalid, no tower appeared, and the money did not move. A build that spends and
// refuses, or refuses and spends, or shows a valid preview it then declines to
// commit, fails on the one of the three it got wrong.
//
// WHAT EVERY WRONG MODEL READS. A build that compares against the money it
// STARTED with reads valid; one that lets the balance go negative reads `-1`; one
// that clamps the balance at zero after spending reads `0` and a tower on the
// floor. Only `(invalid, no tower, 149)` passes.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";

/** The type whose purchase is refused. */
const TYPE: TowerType = "bloom";

/** What `specs/towers.md` charges for it. */
const COST = TOWER_DEFS[TYPE].cost;

/**
 * The footprint's top-left tile: open floor, wholly on the grid, sealing
 * nothing.
 */
const SPOT = { col: 20, row: 12 } as const;

/**
 * The purse the placement is refused with: one short of the cost.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number
 * and `specs/building.md` fixes the comparison exactly, so one unit short is
 * unaffordable.
 */
const SHORT_PURSE = COST - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Arm `TYPE` over `SPOT` with `purse` on hand, and read what the preview says. */
function armWith(purse: number): boolean {
  h.debug.setArmed(null);
  h.debug.setMoney(purse);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(SPOT.col, SPOT.row);
  const held = h.snapshot().build;
  return held !== null && held.valid;
}

it("refuses a placement the money cannot cover, and spends nothing on it", async () => {
  startRun(h);

  const affordable = armWith(COST);
  const unaffordable = armWith(SHORT_PURSE);
  h.debug.place();
  await h.advance(1);

  captureStill(h, "refused");
  const after = h.snapshot();

  assertTrue(
    affordable,
    "precondition: the same footprint is placeable with the cost on hand",
  );
  assertEqual(
    unaffordable,
    false,
    "whether the preview read valid one short of the cost",
  );
  assertLength(after.towers, 0, "the towers the refused placement built");
  assertEqual(
    after.money,
    SHORT_PURSE,
    "the money left after the refused placement",
  );
});

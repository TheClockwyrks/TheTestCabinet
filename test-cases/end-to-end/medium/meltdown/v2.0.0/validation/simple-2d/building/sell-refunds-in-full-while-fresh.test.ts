// building/sell-refunds-in-full-while-fresh — a tower that has yet to face a wave
// refunds every coin spent on it.
//
// specs/building.md, Selling: the refund on a fresh tower is "`spent`, in full, with
// no rounding". And, from Freshness: "A tower placed while the phase is `opening` or
// `building` is fresh from the frame it lands."
//
// THE TOWER IS PLACED RATHER THAN POSED, and that is deliberate. The item is about a
// tower placed this build phase, before the wave starts, so the two rules that meet
// here are reached the way a player reaches them: the run is at a `building` phase,
// the tower is committed through `place`, and the specification's freshness rule is
// what has to make it fresh. A tower posed with `setTowerFresh(id, true)` would test
// the second half of the pair only.
//
// AND THE ROUND TRIP IS THE READING. The purse pays the build cost out and the sale
// pays it back, so a conformant build ends on exactly the balance it opened with —
// which is a stronger reading than the refund figure alone, because it also catches
// a build whose refund is right and whose payment is not. The figure is asserted
// too, so a failure names which end of the trip went wrong.
//
// AN ARC IS USED because `0.7 * 15` is `10.5`: a build that applied the stale rate
// to this fresh tower reads 10 against 15, and one that rounded that rate up reads
// 11, so every wrong model lands on its own number rather than on a shared one.
//
// THE WORLD GATE IS SHUT BY `startRun`, so the fifteen seconds on the build timer
// cannot start Wave 1 underneath the reading and take the tower's freshness with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { placeAt, requirePlaced } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower placed and sold, on a quiet anchor, and its build cost. */
const HELD = "arc";
const AT = FREE_SITE;
const COST = TOWER_DEFS[HELD].cost;

/** A round purse, so the arithmetic in a failure is legible. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays the whole spend back on a tower placed this build phase", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  assertEqual(
    h.snapshot().phase,
    "building",
    "the phase the tower is placed in",
  );

  const id = requirePlaced(
    placeAt(h, HELD, AT.col, AT.row),
    `a ${HELD} on open floor at (${AT.col}, ${AT.row})`,
  );

  const placed = h.snapshot();
  const tower = towerOf(placed, id);
  assertEqual(
    tower.fresh,
    true,
    `whether a ${HELD} placed in a building phase is fresh`,
  );
  assertEqual(tower.spent, COST, `the money spent on the ${HELD} just placed`);
  assertEqual(
    tower.refund,
    COST,
    `the refund a fresh ${HELD} reports, its whole spend of ${COST} with no rounding`,
  );
  assertEqual(
    placed.money,
    PURSE - COST,
    `the balance the placement left, out of a purse of ${PURSE}`,
  );

  h.debug.sellTower(id);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "refund");

  assertEqual(
    after.money,
    PURSE,
    `the balance after selling the fresh ${HELD} the same phase built it`,
  );
});

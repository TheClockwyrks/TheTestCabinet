// economy/unaffordable-controls-are-disabled — a purchase the balance cannot
// cover is drawn as one the player cannot take.
//
// `specs/expedition.md`: "Credits never go negative, and an action that cannot be
// afforded is disabled." `specs/controls.md` says what "disabled" means on
// screen: "A control is drawn as operable only where it acts. Where the game
// cannot act on a control in the state it is in, that control is drawn disabled
// or is not drawn at all."
//
// THIS IS THE DRAWN HALF, and it is a different reading from
// `economy/unaffordable-refused`, which asks what a purchase DOES on a balance
// that cannot cover it. A build can refuse the purchase correctly and still offer
// the control as though it were live, which is the state a player reads as the
// game being broken.
//
// THE PRICE THE INCREMENT IS HELD TO IS ITS OWN. The Fuel Depot's fixed
// increment buys `FUEL_BUY_INCREMENT` in one go, so what it cannot afford is the
// whole of that, `FUEL_BUY_INCREMENT * FUEL_PRICE`; filling to full "pay[s] only
// for what is missing and only as far as the Credits reach", so it is still an
// action on a single Credit. A build that puts both behind one predicate gets one
// of the two wrong, and the balance either side of the increment's own price is
// where that shows.
//
// HOW A TREATMENT IS READ WITHOUT A PALETTE OR A LAYOUT. Neither is fixed by any
// spec, so what is read is that the panel is DRAWN DIFFERENTLY one Credit short
// of the price than at it — the same reading `hud/fuel-alert` takes of the alert
// treatment, and paired with the same kind of control: a second pair of balances
// one Credit apart, well clear of every threshold, so what the straddling pair
// moves beyond it is the treatment rather than the balance the panel prints.
//
// Each row is read with the OTHER row full, so the only control whose state
// changes across a pair is the one the pair is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  FUEL_TIERS,
  HULL_TIERS,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
} from "../constants";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { changed, sampleView } from "../hud/bar";
import { openCamp } from "./camp";

/** What one press of each fixed increment costs, all or nothing. */
const FUEL_INCREMENT_COST = FUEL_BUY_INCREMENT * FUEL_PRICE;
const REPAIR_INCREMENT_COST = REPAIR_BUY_INCREMENT * REPAIR_PRICE;

/**
 * How far above a price the control pair for that row is read.
 *
 * Ten Credits up, so the control pair's two balances are the same length as the
 * straddling pair's and change in the same place — `34` to `35` against `24` to
 * `25`, and `59` to `60` against `49` to `50`. What the panel prints of the
 * balance therefore moves the same pixels in both pairs, and what is left over in
 * the straddling one is the control's treatment.
 */
const CONTROL_OFFSET = 10;

/** A hull that is spent but nowhere near empty, so no death is in play. */
const SPENT_HULL = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the Fuel Depot's fixed increments differently one Credit short of their price", async () => {
  openCamp(h);
  h.debug.setPanel("fuel-depot");

  /** Draw the depot at a balance and read the whole panel back. */
  const at = (credits: number): Promise<number[]> => {
    h.debug.setCredits(credits);
    return sampleView(h);
  };

  // The fuel row, with the hull full so nothing on it changes.
  h.debug.setHull(HULL_TIERS[0]);
  h.debug.setFuel(0);
  const fuelControlHigh = await at(FUEL_INCREMENT_COST + CONTROL_OFFSET);
  const fuelControlLow = await at(FUEL_INCREMENT_COST + CONTROL_OFFSET - 1);
  const fuelAffordable = await at(FUEL_INCREMENT_COST);
  const fuelShort = await at(FUEL_INCREMENT_COST - 1);
  captureStill(h, "disabled");

  // The hull row, with the tank full so nothing on it changes.
  h.debug.setFuel(FUEL_TIERS[0]);
  h.debug.setHull(SPENT_HULL);
  const hullControlHigh = await at(REPAIR_INCREMENT_COST + CONTROL_OFFSET);
  const hullControlLow = await at(REPAIR_INCREMENT_COST + CONTROL_OFFSET - 1);
  const hullAffordable = await at(REPAIR_INCREMENT_COST);
  const hullShort = await at(REPAIR_INCREMENT_COST - 1);

  const fuelControl = changed(fuelControlHigh, fuelControlLow);
  const fuelStraddling = changed(fuelAffordable, fuelShort);
  const hullControl = changed(hullControlHigh, hullControlLow);
  const hullStraddling = changed(hullAffordable, hullShort);

  assertGreaterThan(
    fuelStraddling,
    0,
    "specs/controls.md: the fuel increment is drawn differently below its own price",
  );
  assertGreaterThan(
    fuelStraddling,
    fuelControl,
    "specs/controls.md: and by more than the balance printed beside it changes",
  );
  assertGreaterThan(
    hullStraddling,
    0,
    "specs/controls.md: the repair increment is drawn differently below its own price",
  );
  assertGreaterThan(
    hullStraddling,
    hullControl,
    "specs/controls.md: and by more than the balance printed beside it changes",
  );
});

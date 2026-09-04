// weight/overload-flag — the overload reading follows the load fraction.
//
// specs/character.md: "the status bar reads `OVERLOAD` while `load` is `1` or
// more", and specs/instrumentation.md derives the snapshot's `overloaded` from
// `loadKg` against `liftLimitKg`. So the flag is true exactly at and above a load
// fraction of `1`, and false below it: it flips on the unit that crosses the
// limit rather than a unit either side of it.
//
// The bay is posed either side of the limit in units of one ore, so the two
// readings differ by one unit of Ferron. At jetpack tier 1 the lift limit is
// `350` kilograms and Ferron weighs `10`, so thirty-five units is exactly the
// limit — the "or more" end of the sentence — and thirty-four is one unit under
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { JETPACK_LIFT_LIMIT, ORES } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  loadFraction,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";

/** The jetpack tier the readings are taken at, and the limit it sets. */
const TIER = 1;
const LIFT = JETPACK_LIFT_LIMIT[TIER - 1];

/** The ore the bay is filled with, and the units either side of the limit. */
const ORE = "ferron";
const AT_LIMIT = LIFT / ORES[ORE].weight;
const UNDER = AT_LIMIT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips the overload flag on the unit that reaches the lift limit", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);

  await stageCargo(h, { [ORE]: UNDER });
  const under = await h.snapshot();
  assertEqual(under.cargo.liftLimitKg, LIFT, "specs/upgrades.md");
  assertEqual(under.cargo.loadKg, UNDER * ORES[ORE].weight, "specs/mining.md");
  assertEqual(loadFraction(under) < 1, true, "specs/character.md");
  assertEqual(under.miner.overloaded, false, "specs/character.md");

  await stageCargo(h, { [ORE]: AT_LIMIT });
  await h.debug.setPanel("inventory");
  await h.advance(1);
  await captureStill(h, "flag");

  const at = await h.snapshot();
  assertEqual(at.cargo.loadKg, LIFT, "specs/mining.md");
  assertEqual(loadFraction(at), 1, "specs/character.md");
  assertEqual(at.miner.overloaded, true, "specs/character.md");
});

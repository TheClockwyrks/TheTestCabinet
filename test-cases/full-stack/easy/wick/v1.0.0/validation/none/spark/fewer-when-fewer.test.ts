// Wick — spark/fewer-when-fewer: fewer strikes land when fewer enemies are in
// range than the amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's center,
// fewer when fewer such enemies exist." Row 5 of `SPARK_LEVELS` gives amount
// `3`, and with no Lure held `amountBonus` is `0` (`specs/passives.md`). So
// with one moth in range the firing tick creates exactly one strike zone,
// centered on it.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// on the target ring, `200` out, then Spark held at level 5 and fired through
// the shared `fireWeapon`. `enemyMotion` is held so the moth stands where it
// was posed on the firing tick.
//
// TOLERANCE. None on the count, which is exact; `POSITION_TOL` on the one
// strike's center against the moth's posed center, so a build that landed a
// strike on nothing fails here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import {
  SPARK,
  assertCenteredOn,
  placeTargets,
  ringPoints,
  strikesOf,
} from "./stage";

/** The level whose row carries amount `3`. */
const LEVEL = 5;

/** The one moth in range: the first point of the target ring. */
const MOTHS = ringPoints(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one strike zone at level 5, amount 3, with one moth in range", async () => {
  assertGreaterThan(
    weaponRow(SPARK, LEVEL).amount ?? 0,
    MOTHS.length,
    "row 5's amount against the moths in range",
  );
  await isolate(h);
  await placeTargets(h, "moth", MOTHS);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "fewer");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    1,
    "Spark strike zones the level-5 firing tick created with one moth in range",
  );
  assertCenteredOn(strikes[0]!, MOTHS[0]!, "the one strike");
});

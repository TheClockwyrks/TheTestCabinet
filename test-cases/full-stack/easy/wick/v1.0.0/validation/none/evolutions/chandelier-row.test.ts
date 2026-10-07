// Wick — evolutions/chandelier-row: `CHANDELIER_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "On the
// first `playing` tick Chandelier is held and no Chandelier lantern exists ...
// `amount` Chandelier lanterns are created, each a zone of kind `lantern` with
// `ttl` `null`, a fresh id, and empty `hits`, on a circle of radius `orbit`
// centered on the player's center", and "The fixed row is `CHANDELIER_STATS`":
// damage `25`, orbit `120`, radius `20`, amount `4`. ("Passives still apply"):
// "every width, height, radius, and orbit is the fixed length times `areaMul`"
// and damage is "the fixed damage times `damageMul`", both `1` with no passive
// held (`specs/passives.md`), and amount is the fixed amount plus an
// `amountBonus` of `0`. `specs/instrumentation.md` ("Snapshot shape"):
// "`zones[].ttl` is `null` for a zone that never expires". So the placing tick
// leaves four zones of kind `lantern` and weapon `chandelier`, each reading
// radius `20`, damage `25`, and ttl `null`, each exactly `120` from the
// lamplighter's center.
//
// THE POSE. An isolated night with the lamplighter posed off the origin — so a
// set placed about `(0, 0)` rather than about "the player's center" is told
// apart, and the origin is not itself the answer — then Chandelier held at level
// 1 through `setWeapon` and one tick. Every driver switch stays off:
// `specs/instrumentation.md` has "Placement ... gated by neither `weaponFire`
// nor `effectMotion`", so the set appears on a night where nothing else runs.
//
// TOLERANCE. `POSITION_TOL` on the radius and on each distance from the
// lamplighter's center, each a fixed figure times `1`; `FLOAT_TOL` on the
// damage. The count and the `null` ttl are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  player,
  type Harness,
} from "../harness";
import { assertOnOrbit, placeChandelierSet } from "./stage";

/** Chandelier's fixed row, `CHANDELIER_STATS`. */
const ROW = weaponRow("chandelier");

/** Where the lamplighter stands: off the origin, so the orbit is read from him. */
const PLAYER = { x: 240, y: -120 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates four lantern zones of radius 20 with damage 25 and ttl null on a circle of radius 120", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);

  const set = await placeChandelierSet(h);
  await captureStill(h, "row");

  assertEqual(
    set.lanterns.length,
    ROW.amount,
    "Chandelier lantern zones the placing tick created",
  );
  for (const lantern of set.lanterns) {
    assertNear(
      lantern.radius,
      ROW.radius ?? NaN,
      POSITION_TOL,
      `lantern ${lantern.id}'s radius`,
    );
    assertNear(
      lantern.damage,
      ROW.damage,
      FLOAT_TOL,
      `lantern ${lantern.id}'s damage`,
    );
    assertNull(lantern.ttl, `lantern ${lantern.id}'s ttl`);
  }
  assertOnOrbit(
    set.lanterns,
    player(set.after),
    ROW.orbit ?? NaN,
    "the placed set",
  );
});

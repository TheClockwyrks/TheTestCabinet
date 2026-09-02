// Wick — evolutions/chandelier-replaces-lantern-set: Chandelier's first tick
// removes any Lantern lanterns and places its own.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "On the
// first `playing` tick Chandelier is held and no Chandelier lantern exists, any
// Lantern lanterns still in the world are removed and `amount` Chandelier
// lanterns are created, each a zone of kind `lantern` with `ttl` `null`, a fresh
// id, and empty `hits`, on a circle of radius `orbit` centered on the player's
// center, lantern `i`, counted from `0`, at angle `i × 360 / amount`."
// `CHANDELIER_STATS` gives amount `4`, so the four stand at `0`, `90`, `180`,
// and `270` degrees — `specs/weapons.md` ("The nearest enemy") fixes angles as
// "in degrees, with `0` along `+x` and positive angles turning toward `+y`".
//
// THE POSE. An isolated night, Lantern held at level 8 and fired through the
// shared `fireWeapon` so a real set of its lanterns stands in the world, then
// `weaponFire` off and the Lantern slot emptied through `removeWeapon` and
// Chandelier placed through `setWeapon`: the two cannot be held at once, since
// `setWeapon` calls "a base weapon whose evolution is held in another slot"
// invalid. Neither pose ticks, so the Lantern lanterns are still in the world
// when the next tick runs, which is the state the rule is written over. Level 8
// is the Lantern row with four lanterns, so a build that left them behind is
// read as eight lantern zones rather than as a count that happens to match.
// Every driver switch stays off, since "Placement is gated by neither
// `weaponFire` nor `effectMotion`" (`specs/instrumentation.md`).
//
// TOLERANCE. `ANGLE_TOL` on each of the four angles and `POSITION_TOL` on each
// distance from the lamplighter's center; the counts, the ids, and the empty
// `hits` are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import { MAX_WEAPON_LEVEL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  player,
  type Harness,
  zonesOf,
} from "../harness";
import {
  assertAnglesAre,
  assertNoHits,
  assertOnOrbit,
  placeChandelierSet,
  spacedAngles,
} from "./stage";

/** Chandelier's fixed row, `CHANDELIER_STATS`. */
const ROW = weaponRow("chandelier");

/** The Lantern level fired first: row 8, whose set is four lanterns. */
const LANTERN_LEVEL = MAX_WEAPON_LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the Lantern lanterns and creates four fresh Chandelier lanterns at 0, 90, 180 and 270 degrees", async () => {
  await isolate(h);
  const lit = await fireWeapon(h, "lantern", LANTERN_LEVEL);
  await disable(h, "weaponFire");
  const standing = zonesOf(lit.after, "lantern").filter(
    (zone) => zone.kind === "lantern",
  );
  assertGreaterThanOrEqual(
    standing.length,
    1,
    "Lantern lanterns standing when Chandelier is placed",
  );
  await h.debug.removeWeapon(lit.slot);

  const set = await placeChandelierSet(h);
  await captureStill(h, "replaced");

  assertEqual(
    zonesOf(set.after, "lantern").filter((zone) => zone.kind === "lantern")
      .length,
    0,
    "Lantern lanterns left after Chandelier's first tick",
  );
  assertEqual(
    set.lanterns.length,
    ROW.amount,
    "Chandelier lantern zones the tick created",
  );
  const old = new Set(standing.map((zone) => zone.id));
  for (const lantern of set.lanterns) {
    assertTrue(
      !old.has(lantern.id),
      `lantern ${lantern.id} carries a fresh id, not one of the Lantern set's`,
    );
    assertNoHits(lantern, "the fresh Chandelier set");
  }
  const center = player(set.after);
  assertOnOrbit(set.lanterns, center, ROW.orbit ?? NaN, "the fresh set");
  assertAnglesAre(
    set.lanterns,
    center,
    spacedAngles(ROW.amount as number),
    "the fresh set",
  );
});

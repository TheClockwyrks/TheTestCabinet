// Wick — evolutions/chandelier-respaces-on-amount-change: a change in amount
// replaces the set with fresh lanterns, evenly spaced from the angle the
// lowest-id lantern held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "On any
// tick on which `amount` differs from the number of Chandelier lanterns in the
// world, the lanterns are replaced by `amount` new zones with fresh ids and
// empty `hits`, lantern `i` at `i × 360 / amount` degrees from the angle the
// lowest-id lantern held." `CHANDELIER_STATS` gives amount `4`, and
// `specs/passives.md` ("Amount") gives `amountBonus = MIRROR_AMOUNT_PER_LEVEL ×
// mirror`, `1` at Mirror 1, and lists Chandelier among the weapons that take
// the bonus. So on the tick after Mirror rises to `1` the amount in force is
// `5`, none of the four lanterns is left, and five new ones stand `360 / 5 = 72`
// degrees apart, the first on the angle the lowest-id lantern of the old set
// held.
//
// WHY THE SET IS TURNED FIRST, AND THEN HELD. The base of the new spacing is an
// angle read off the old set, so a set standing at `0`, `90`, `180`, `270` would
// leave a build that respaced from `0` indistinguishable from one that respaced
// from the lantern's angle. So the set is turned for `TURN_TICKS` with
// `effectMotion` on first, which is the switch "lanterns revolve" under
// (`specs/instrumentation.md`), and the base is read from the snapshot rather
// than computed, so the reading is the respacing rather than the revolution.
// `effectMotion` is then turned off for the replacing tick, so the angle the
// lowest-id lantern held entering the tick is the angle it holds on it ("every
// lantern holds its angle" while the switch is off) and the five new angles are
// fixed exactly by the specification's own sentence.
//
// THE POSE. An isolated night with `effectMotion` on, Chandelier held and one
// tick to place the four, `TURN_TICKS` ticks of revolving, `effectMotion` off,
// Mirror at level 1 through `setPassive`, and one tick. Placement is "gated by
// neither `weaponFire` nor `effectMotion`", so the replacement runs on a night
// where nothing else does; no enemy is posed, so no lantern hits anything and
// the empty `hits` of the new set is the specification's rather than an
// accident.
//
// TOLERANCE. `ANGLE_TOL` on each of the five angles about the base read off the
// old set; the count, the fresh ids, and the empty `hits` are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { MIRROR_AMOUNT_PER_LEVEL, weaponRow } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  disable,
  holdPassive,
  isolate,
  player,
  type Harness,
} from "../harness";
import {
  assertAnglesAre,
  assertNoHits,
  chandelierLanterns,
  lowestId,
  placeChandelierSet,
  spacedAngles,
} from "./stage";

/** Mirror's posed level. */
const MIRROR_LEVEL = 1;

/** The amount in force after the change: `4 + 1`. */
const AMOUNT_AFTER =
  (weaponRow("chandelier").amount as number) +
  MIRROR_AMOUNT_PER_LEVEL * MIRROR_LEVEL;

/** How far the set is turned first, so the base of the spacing is not `0`. */
const TURN_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("replaces the four lanterns with five fresh ones spaced 72 degrees apart from the angle the lowest-id lantern held", async () => {
  await isolate(h, { on: ["effectMotion"] });
  const set = await placeChandelierSet(h);
  const turned = await h.step(TURN_TICKS);
  await disable(h, "effectMotion");

  const standing = chandelierLanterns(turned);
  assertEqual(
    standing.length,
    weaponRow("chandelier").amount,
    "Chandelier lanterns standing before the amount changes",
  );
  const base = angleFrom(player(turned), lowestId(standing, "the turned set"));
  const old = new Set(standing.map((lantern) => lantern.id));

  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const changed = await h.step(1);
  await captureStill(h, "five");

  const lanterns = chandelierLanterns(changed);
  assertEqual(
    lanterns.length,
    AMOUNT_AFTER,
    "Chandelier lanterns on the tick after Mirror rose to 1",
  );
  for (const lantern of lanterns) {
    assertTrue(
      !old.has(lantern.id),
      `lantern ${lantern.id} carries a fresh id, not one of the four replaced`,
    );
    assertNoHits(lantern, "the respaced set");
  }
  assertAnglesAre(
    lanterns,
    player(changed),
    spacedAngles(AMOUNT_AFTER, base),
    "the respaced set",
  );
  assertEqual(
    set.lanterns.length,
    standing.length,
    "the set the placing tick created",
  );
});

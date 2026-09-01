// evolutions/chandelier-respaces-on-amount-change — Chandelier replaces its
// lanterns when amount changes.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "On
// any tick on which `amount` differs from the number of Chandelier lanterns in
// the world, the lanterns are replaced by `amount` new zones with fresh ids
// and empty `hits`, lantern `i` at `i × 360 / amount` degrees from the angle
// the lowest-id lantern held." `CHANDELIER_STATS` gives amount 4, and
// `specs/passives.md` ("Amount") gives `amountBonus = MIRROR_AMOUNT_PER_LEVEL
// × mirror` with `MIRROR_AMOUNT_PER_LEVEL` (`1`), naming Chandelier among the
// weapons that take the bonus — so Mirror at 1 makes the amount 5. The five
// then sit 72 degrees apart, `360 / 5`, measured from the angle the lowest-id
// lantern of the standing set held, with angles read "`0` along `+x` and
// positive angles turning toward `+y`" (`specs/weapons.md`, The nearest
// enemy). A fresh id is one at or above the `nextId` the snapshot reported
// before the tick (`specs/instrumentation.md`).
//
// WHY THE REFERENCE ANGLE IS READ RATHER THAN ASSUMED. The rule spaces the new
// set FROM the angle the lowest-id lantern held, whatever that is, so the
// standing set's lowest-id lantern is read off the snapshot after the placing
// tick and the five expected angles are computed from it. `effectMotion` is
// off throughout, so that angle is still the angle the set holds when Mirror
// is placed and on the tick that replaces it — "every lantern holds its angle"
// (`specs/instrumentation.md`).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Chandelier, the lamplighter posed off the origin so the angles read are
// angles about the LAMPLIGHTER, every driver switch off so nothing revolves,
// refires or spawns between the two readings. Mirror is placed through
// `setPassive` and read back, so a surface that did not place it fails there
// rather than on a count that was never at risk.
//
// THE TOLERANCE. `ANGLE_EPS` on each angle and `REAL_EPS` on each orbit, both
// figures a build reaches through one sine and one cosine; the counts, the ids
// and the empty `hits` are read exactly. Five lanterns 72 degrees apart and
// four 90 degrees apart share only the reference angle, so a set that was not
// respaced fails on four of the five.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNear,
} from "../assert";
import {
  ANGLE_EPS,
  CHANDELIER_STATS,
  REAL_EPS,
  amountBonus,
} from "../constants";
import {
  advanceTicks,
  angularOffset,
  captureStill,
  createHarness,
  holdPassive,
  passiveLevel,
  type Harness,
} from "../harness";
import {
  POSED,
  angleAbout,
  chandelierLanterns,
  orbitOf,
  placeChandelier,
} from "./evolved";

/** Mirror at level 1: an amount bonus of 1, for a total of 5. */
const MIRROR_LEVEL = 1;

/** The amount after the change: `4 + 1`. */
const AMOUNT = CHANDELIER_STATS.amount + amountBonus(MIRROR_LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("replaces the four lanterns with five fresh ones spaced 72 degrees from the lowest-id lantern's angle", async () => {
  const placed = await placeChandelier(h, POSED);
  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing before Mirror is held (specs/evolutions.md, Chandelier)",
  );
  const lowest = placed.lanterns.reduce((least, lantern) =>
    lantern.id < least.id ? lantern : least,
  );
  const reference = angleAbout(placed.after, lowest);

  holdPassive(h, "mirror", MIRROR_LEVEL);
  assertEqual(
    passiveLevel(h.snapshot(), "mirror"),
    MIRROR_LEVEL,
    "Mirror's level after the pose (specs/instrumentation.md, setPassive)",
  );
  const before = h.snapshot();

  const after = await advanceTicks(h, 1);
  captureStill(h, "five");

  const lanterns = chandelierLanterns(after);
  assertEqual(
    lanterns.length,
    AMOUNT,
    `the Chandelier lanterns standing after the tick Mirror ${MIRROR_LEVEL} raised the amount to ${AMOUNT} (specs/evolutions.md, Chandelier)`,
  );
  for (const lantern of lanterns) {
    assertGreaterThanOrEqual(
      lantern.id,
      before.run.nextId,
      `lantern ${lantern.id}'s id, which the replacement makes fresh (specs/evolutions.md, Chandelier)`,
    );
    assertLength(
      lantern.hits,
      0,
      `lantern ${lantern.id}'s hits, which a replaced lantern carries empty (specs/evolutions.md, Chandelier)`,
    );
    assertNear(
      orbitOf(after, lantern),
      CHANDELIER_STATS.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center (specs/evolutions.md, CHANDELIER_STATS)`,
    );
  }

  const placedAngles = lanterns.map((lantern) => ({
    id: lantern.id,
    angle: angleAbout(after, lantern),
  }));
  for (let i = 0; i < AMOUNT; i += 1) {
    const wanted = reference + (i * 360) / AMOUNT;
    const matching = placedAngles.filter(
      (lantern) => Math.abs(angularOffset(wanted, lantern.angle)) <= ANGLE_EPS,
    );
    assertEqual(
      matching.length,
      1,
      `the lanterns standing at ${(((wanted % 360) + 360) % 360).toFixed(3)} degrees, ${i} × 72 from the ${reference.toFixed(3)} the lowest-id lantern held, among ${placedAngles
        .map((lantern) => lantern.angle.toFixed(3))
        .join(", ")} (specs/evolutions.md, Chandelier)`,
    );
  }
});

// Wick — evolutions/chandelier-replaces-lantern-set: Chandelier's first tick
// removes any Lantern lanterns and creates its own set.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "On the first `playing` tick
//     Chandelier is held and no Chandelier lantern exists, any Lantern lanterns
//     still in the world are removed and `amount` Chandelier lanterns are
//     created, each a zone of kind `lantern` with `ttl` `null`, a fresh id, and
//     empty `hits`, on a circle of radius `orbit` centered on the player's
//     center, lantern `i`, counted from `0`, at angle `i × 360 / amount`." With
//     the fixed amount `4` the four angles are 0, 90, 180, and 270.
//   - `specs/weapons.md` ("Lantern"): a Lantern firing creates the set of its
//     own row; row 1 has orbit `90`, radius `14`, damage `10`, and amount `1`,
//     so the Lantern lantern is told from a Chandelier one by every figure as
//     well as by `weapon` (`specs/state.md`, `ZoneState`).
//   - `specs/instrumentation.md` (`setWeapon`): "When the slot's `id` changes
//     its cooldown timer becomes `0`. Nothing else changes: the aura of Halo or
//     Corona and the lanterns of Chandelier appear on the next `playing` tick
//     under the placement rule", so the replacement is the tick's doing.
//   - `specs/state.md` (`ZoneState`): `id` is "unique for the run, assigned
//     from `nextId`", so a lantern whose id is at least the `nextId` read
//     before the tick is one the tick created.
//   - `specs/weapons.md` ("The nearest enemy"): "Angles are in degrees, with
//     `0` along `+x` and positive angles turning toward `+y`".
//
// WHAT IS READ. After the tick that follows putting Chandelier in Lantern's
// slot: no zone with weapon `lantern` stands; exactly four stand with weapon
// `chandelier`; every one of the four carries an id at least the `nextId` read
// before the tick and an empty `hits`; and their angles about the lamplighter
// are 0, 90, 180, and 270. The four angles are read as a set, since the
// specification fixes the angle of lantern `i` and not which id it takes.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern at level 1 first, fired once so a
// set of its own is live when Chandelier arrives, then Chandelier placed in
// that same slot; `weaponFire` is turned off again before the replacing tick,
// so the tick read is the placement alone and Lantern's spent timer cannot fire
// a second set into it; `effectMotion` off throughout, so the angles read are
// the ones the placement gave and the revolution, which starts "From the next
// tick", cannot move them; nothing else on the field.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each angle, an exact figure read back
// through the build's own trigonometry. None on the counts, the ids, or the
// `hits`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertWithin } from "../assert";
import { CHANDELIER_STATS, FIGURE_TOLERANCE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  disable,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { anglesOf, baseLanterns, chandelierLanterns } from "./chandelier";

/** The level Lantern is held at: one lantern, of the base weapon's own figures. */
const LANTERN_LEVEL = 1;

/** The angles the placement gives lantern `i`: `i × 360 / amount`. */
const ANGLES = Array.from(
  { length: CHANDELIER_STATS.amount },
  (_, i) => (i * 360) / CHANDELIER_STATS.amount,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the Lantern set and creates four fresh Chandelier lanterns at 0, 90, 180 and 270", async () => {
  isolate(h);
  const slot = holdWeapon(h, "lantern", LANTERN_LEVEL);
  armWeapon(h, slot);

  const fired = await h.tick(1);
  assertGreaterThanOrEqual(
    baseLanterns(fired).length,
    1,
    "Lantern lanterns live before Chandelier is held",
  );
  disable(h, "weaponFire");

  h.debug.setWeapon(slot, "chandelier", 1);
  const before = h.snapshot();
  const freshFrom = before.run.nextId;

  const after = await h.tick(1);
  captureStill(h, "replaced");

  assertEqual(
    baseLanterns(after).length,
    0,
    "Lantern lanterns after the tick Chandelier was first held",
  );
  const set = chandelierLanterns(after);
  assertEqual(
    set.length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after that tick",
  );
  for (const lantern of set) {
    assertGreaterThanOrEqual(
      lantern.id,
      freshFrom,
      `lantern ${lantern.id}: its id against the nextId before the tick, a fresh id`,
    );
    assertEqual(lantern.hits.length, 0, `lantern ${lantern.id}: hits entries`);
  }
  anglesOf(set, after.run.player).forEach((angle, index) => {
    assertWithin(
      angle,
      ANGLES[index],
      FIGURE_TOLERANCE,
      `the ${index + 1}th angle of the set, ascending`,
    );
  });
});

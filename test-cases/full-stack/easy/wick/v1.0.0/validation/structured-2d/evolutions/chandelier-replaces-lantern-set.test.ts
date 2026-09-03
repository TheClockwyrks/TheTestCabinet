// evolutions/chandelier-replaces-lantern-set — Chandelier's first tick
// replaces any Lantern lanterns.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "On
// the first `playing` tick Chandelier is held and no Chandelier lantern
// exists, any Lantern lanterns still in the world are removed and `amount`
// Chandelier lanterns are created, each a zone of kind `lantern` with `ttl`
// `null`, a fresh id, and empty `hits`, on a circle of radius `orbit` centered
// on the player's center, lantern `i`, counted from `0`, at angle
// `i × 360 / amount`." `CHANDELIER_STATS` gives amount 4 and orbit 120, and
// with no passive held `amountBonus` is 0 and `areaMul` is 1
// (`specs/passives.md`), so the four start at 0, 90, 180 and 270 degrees —
// angles measured with "`0` along `+x` and positive angles turning toward
// `+y`" (`specs/weapons.md`, The nearest enemy). A fresh id is one at or above
// the `nextId` the snapshot reported before the tick
// (`specs/instrumentation.md`: "A pose that creates an entity gives it the
// next id from `nextId`").
//
// HOW A LANTERN SET IS PUT IN THE WORLD FIRST. Lantern is held at level 2 and
// armed, and the one tick it fires on creates its set: two lanterns on a
// circle of radius 90 with a duration of 3.0 seconds, 180 ticks
// (`specs/weapons.md`, Lantern), so they are still standing when the
// replacement tick runs. Chandelier then takes that same slot through
// `setWeapon`, which is what the evolution does — "The evolved weapon replaces
// its base in the same slot" (`specs/evolutions.md`, Opening a chest) — and
// `weaponFire` is turned off before it, so nothing refires and the tick that
// is read is the placement alone.
//
// WHY THE LEVEL IS 2. Its set differs from Chandelier's in both count and
// orbit, two and 90 against four and 120, so a build that kept the old zones
// and merely renamed them is caught on the count, the orbit and the ids alike.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but that
// one weapon slot, the lamplighter posed off the origin so the angles read are
// angles about the LAMPLIGHTER, every other switch off so nothing moves the
// old set or the new one before they are read.
//
// THE TOLERANCE. `ANGLE_EPS` on each angle and `REAL_EPS` on each orbit, both
// figures a build reaches through one sine and one cosine; the counts, the
// ids and the empty `hits` are read exactly.

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
  LANTERN_LEVELS,
  REAL_EPS,
} from "../constants";
import {
  advanceTicks,
  angularOffset,
  armWeapon,
  captureStill,
  createHarness,
  disable,
  holdWeapon,
  isolate,
  zonesOf,
  type Harness,
} from "../harness";
import { POSED, angleAbout, chandelierLanterns, orbitOf } from "./evolved";

/** The Lantern level whose set stands first: two lanterns, orbit 90. */
const LANTERN_LEVEL = 2;
const LANTERN_ROW = LANTERN_LEVELS[LANTERN_LEVEL - 1];

/** The angles Chandelier's set occupies: `i × 360 / amount` from 0. */
const ANGLES: readonly number[] = Array.from(
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

it("removes the Lantern lanterns and creates four fresh Chandelier lanterns at 0, 90, 180 and 270 degrees", async () => {
  isolate(h);
  h.debug.setPlayerPosition(POSED.x, POSED.y);
  const slot = holdWeapon(h, "lantern", LANTERN_LEVEL);
  armWeapon(h, slot);
  const fired = await advanceTicks(h, 1);
  assertEqual(
    zonesOf(fired, "lantern").length,
    LANTERN_ROW.amount,
    `the Lantern lanterns standing before Chandelier is held (specs/weapons.md, Lantern)`,
  );

  disable(h, "weaponFire");
  h.debug.setWeapon(slot, "chandelier", 1);
  const before = h.snapshot();

  const after = await advanceTicks(h, 1);
  captureStill(h, "replaced");

  assertEqual(
    zonesOf(after, "lantern").length,
    0,
    "the Lantern lanterns left in the world after the first tick Chandelier is held (specs/evolutions.md, Chandelier)",
  );
  const lanterns = chandelierLanterns(after);
  assertEqual(
    lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns the tick created (specs/evolutions.md, Chandelier)",
  );
  for (const lantern of lanterns) {
    assertGreaterThanOrEqual(
      lantern.id,
      before.run.nextId,
      `lantern ${lantern.id}'s id, which must be fresh rather than a Lantern zone's (specs/evolutions.md, Chandelier)`,
    );
    assertLength(
      lantern.hits,
      0,
      `lantern ${lantern.id}'s hits, which a fresh lantern carries empty (specs/evolutions.md, Chandelier)`,
    );
    assertNear(
      orbitOf(after, lantern),
      CHANDELIER_STATS.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center (specs/evolutions.md, CHANDELIER_STATS)`,
    );
  }

  // Each stated angle is claimed by exactly one lantern, matched wrap-aware.
  const placed = lanterns.map((lantern) => ({
    id: lantern.id,
    angle: angleAbout(after, lantern),
  }));
  for (const angle of ANGLES) {
    const matching = placed.filter(
      (lantern) => Math.abs(angularOffset(angle, lantern.angle)) <= ANGLE_EPS,
    );
    assertEqual(
      matching.length,
      1,
      `the lanterns standing at ${angle} degrees from the lamplighter's center, among ${placed
        .map((lantern) => lantern.angle.toFixed(3))
        .join(", ")} (specs/evolutions.md, Chandelier)`,
    );
  }
});

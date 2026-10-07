// passives/glass-fixed-after-creation — a Glass level gained later leaves a
// live shape's lengths as they were.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area: "A shape's
// lengths are fixed when it is created, with one exception: the Halo and
// Corona aura's radius and a Chandelier lantern's orbit and radius are
// recomputed on every tick from the level and `areaMul` in force on that
// tick." A puddle, a bolt, and a Lantern set are none of those, so each keeps
// the lengths its firing tick gave it. With no passive held that tick,
// `areaMul` is `1` (`specs/passives.md`: "a passive not held is level `0`, so
// every multiplier starts at `1`"), so the level-1 rows stand as written:
// Oil Splash `radius` `50`, Ember `radius` `8`, Lantern `orbit` `90` and
// `radius` `14` (`specs/weapons.md`). Glass rising to `2` afterwards, which
// would make a fresh shape `1.2` times as large, leaves all four as they are.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no passive, with
// Oil Splash, Ember, and Lantern at level 1 firing on one tick and one hound
// at `FAR_POST` for Ember to aim at. `weaponFire` goes off the moment that
// tick is done, so no second firing creates a shape under the new Glass level
// and the three read afterwards are the three the first tick made.
// `effectMotion` stays off, so nothing travels and the lanterns hold their
// angle, and the lamplighter does not move, so the circle they ride stays
// centered on the origin. The puddle's `duration` of `2.5` seconds, the bolt's
// `ttl` of `2.0`, and the set's `duration` of `3.0` all outlast the single
// tick run after the Glass level.
//
// THE TOLERANCE. `REAL_EPS` on each radius, a table figure times `1`, and
// `MOTION_EPS` on the orbit, a distance between two centers; the scaled
// figures a build that recomputed them would report are units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  EMBER_LEVELS,
  LANTERN_LEVELS,
  MOTION_EPS,
  OIL_SPLASH_LEVELS,
  REAL_EPS,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  disable,
  distance,
  holdPassive,
  projectileById,
  type Harness,
  zoneById,
} from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Glass level gained after the three shapes exist. */
const GLASS_LATER = 2;

/** The level-1 rows the shapes were created from, with no passive held. */
const PUDDLE = OIL_SPLASH_LEVELS[0];
const BOLT = EMBER_LEVELS[0];
const LANTERN = LANTERN_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a live puddle, bolt, and Lantern set at their unscaled lengths across Glass rising to 2", async () => {
  const firing = await fireUnder(h, {
    weapons: [
      ["oil-splash", 1],
      ["ember", 1],
      ["lantern", 1],
    ],
    enemies: [["hound", FAR_POST]],
  });

  const puddle = firing.zones.find((zone) => zone.kind === "puddle");
  const lantern = firing.zones.find((zone) => zone.kind === "lantern");
  const bolt = firing.projectiles.find((p) => p.weapon === "ember");
  assertEqual(
    [puddle, lantern, bolt].filter((shape) => shape !== undefined).length,
    3,
    "the puddle, lantern, and bolt the firing tick created (specs/weapons.md)",
  );

  disable(h, "weaponFire");
  holdPassive(h, "glass", GLASS_LATER);
  const later = await advanceTicks(h, 1);
  captureStill(h, "fixed");

  assertNear(
    zoneById(later, puddle?.id ?? -1)?.radius ?? NaN,
    PUDDLE.radius,
    REAL_EPS,
    "the live puddle's radius after Glass rose to 2 (specs/passives.md, Area)",
  );
  assertNear(
    projectileById(later, bolt?.id ?? -1)?.radius ?? NaN,
    BOLT.radius,
    REAL_EPS,
    "the live bolt's radius after Glass rose to 2 (specs/passives.md, Area)",
  );
  assertNear(
    zoneById(later, lantern?.id ?? -1)?.radius ?? NaN,
    LANTERN.radius,
    REAL_EPS,
    "the live lantern's radius after Glass rose to 2 (specs/passives.md, Area)",
  );
  assertNear(
    distance(
      zoneById(later, lantern?.id ?? -1) ?? { x: NaN, y: NaN },
      later.run.player,
    ),
    LANTERN.orbit,
    MOTION_EPS,
    "the live lantern's distance from the lamplighter after Glass rose to 2 (specs/passives.md, Area)",
  );
});

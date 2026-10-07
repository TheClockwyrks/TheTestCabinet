// presentation/evolved-effects-drawn-from-own-files — each of the six evolved
// weapons draws its effect from the evolution's own file, not from the base
// weapon's.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": "Each
// of the six evolved weapons has an effect of the same form, frame count, and
// canvas as its base's, at the path below, visibly distinct from its base's so
// a player sees at a glance that the tool has transformed", with the table
// giving `pyre.png`, `beacon.png`, `hail.png`, `chandelier.png`, `corona.png`,
// and `blaze.png` under `assets/sprites/effects/`. The same section fixes where
// each is drawn: "Each weapon has one effect the game draws wherever the
// weapon's shape is live, as `specs/weapons.md` and `specs/evolutions.md`
// define that shape", "drawn centered on the thing it depicts"
// (`specs/assets.md`, "The sprites"), and `specs/world.md`'s camera formula
// puts a world point at `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`.
//
// WHERE EACH SHAPE COMES FROM. `specs/evolutions.md`: Pyre is "two rectangles
// of `width × height`, one extending `width` in the facing direction from the
// player's `x` and one mirrored to the opposite side"; Chandelier creates
// "`amount` Chandelier lanterns ... on a circle of radius `orbit` centered on
// the player's center, lantern `i` ... at angle `i × 360 / amount`", `4` of
// them by `CHANDELIER_STATS`; Corona is "one zone of kind `aura`, a circle of
// `radius` centered on the player's center every tick"; Beacon and Hail are
// circles of `radius`; Blaze's puddles are circles of `radius`. Every centre
// and extent is read off the snapshot rather than restated here, so nothing
// depends on where this scenario put a shape.
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. A build that kept drawing the base weapon's file after the
// evolution fails on the pair it belongs to, and so does one that drew nothing
// there at all.
//
// THE WORLD, AND WHY. An isolated world holding exactly the six evolved shapes
// and nothing else: no enemy, no gem, no pickup, no base weapon, no passive,
// and every driver switch off but `weaponFire`, which is what makes Pyre fire.
// Pyre's two rectangles, Chandelier's four lanterns, and Corona's ring all
// stand about the lamplighter, and the closest two centres among them are `20`
// units apart, ten times the tolerance, so no sprite can be claimed by its
// neighbour. Beacon's bolt, Hail's dart, and Blaze's puddle are POSED through
// the surface, which `specs/instrumentation.md` gives "its figures the ones the
// weapon would give a projectile fired on this tick", so no enemy has to stand
// anywhere for Beacon to have a target and no second shape can arrive; each is
// posed with no velocity and `effectMotion` is off, so all three hold their
// places for the frame that is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  BEACON_STATS,
  CHANDELIER_STATS,
  EVOLUTIONS,
  EVOLUTION_IDS,
  HAIL_STATS,
  PYRE_STATS,
  TAPER_MAX_AMOUNT,
  type EvolutionId,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeProjectile,
  placePuddle,
  projectilesOf,
  zonesOf,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { SPRITE_TOL, drawnFrom, effectFiles } from "./sprites";

/** Where the posed bolt, dart, and puddle stand: clear of everything else. */
const BEACON_AT = { x: 420, y: -260 };
const HAIL_AT = { x: -420, y: -260 };
const BLAZE_AT = { x: 0, y: 300 };

/** How many shapes each evolution owns in this scenario, from its fixed row. */
const SHAPE_COUNT: Readonly<Record<EvolutionId, number>> = {
  pyre: Math.min(PYRE_STATS.amount, TAPER_MAX_AMOUNT),
  beacon: 1,
  hail: 1,
  chandelier: CHANDELIER_STATS.amount,
  corona: 1,
  blaze: 1,
};

/** Every shape evolution `id` holds, as its centre. */
function shapesOf(
  id: EvolutionId,
  snapshot: WickSnapshot,
): { x: number; y: number }[] {
  const held =
    id === "beacon" || id === "hail"
      ? projectilesOf(snapshot, id)
      : zonesOf(snapshot, id);
  return held.map((shape) => ({ x: shape.x, y: shape.y }));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each evolved weapon's effect from its own produced file", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");

  holdWeapon(h, "chandelier", 1);
  holdWeapon(h, "corona", 1);
  const pyre = holdWeapon(h, "pyre", 1);
  placeProjectile(
    h,
    "beacon",
    BEACON_AT.x,
    BEACON_AT.y,
    0,
    0,
    BEACON_STATS.pierce,
  );
  placeProjectile(h, "hail", HAIL_AT.x, HAIL_AT.y, 0, 0, HAIL_STATS.pierce);
  placePuddle(h, "blaze", BLAZE_AT.x, BLAZE_AT.y);
  // `setWeaponCooldown(slot, 0)` makes the next tick Pyre's firing tick
  // (`specs/instrumentation.md`), and `weaponFire` lets it fire.
  armWeapon(h, pyre);

  const blits = await h.frameBlits();
  captureStill(h, "evolved");
  const snapshot = h.snapshot();

  for (const id of EVOLUTION_IDS) {
    const base = EVOLUTIONS[id].from;
    const own = effectFiles(id);
    const inherited = effectFiles(base);
    const shapes = shapesOf(id, snapshot);
    assertLength(
      shapes,
      SHAPE_COUNT[id],
      `the live ${id} shapes the tick left`,
    );

    for (const shape of shapes) {
      const drawn = drawnFrom(h, blits, own, shape.x, shape.y, SPRITE_TOL);
      assertGreaterThan(
        drawn.length,
        0,
        `one of ${own.join(", ")} drawn centred on the ${id} shape standing ` +
          `at (${shape.x.toFixed(2)}, ${shape.y.toFixed(2)})`,
      );
      const fromBase = drawnFrom(
        h,
        blits,
        inherited,
        shape.x,
        shape.y,
        SPRITE_TOL,
      );
      assertTrue(
        fromBase.length === 0,
        `no ${base} effect file drawn on the ${id} shape standing at ` +
          `(${shape.x.toFixed(2)}, ${shape.y.toFixed(2)})`,
      );
    }
  }
});

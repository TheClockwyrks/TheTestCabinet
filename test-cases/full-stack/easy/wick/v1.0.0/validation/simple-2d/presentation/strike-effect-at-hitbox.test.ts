// presentation/strike-effect-at-hitbox — a frame of the strike sheet is drawn
// over the circle a live strike hit with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "strike | Spark | assets/sprites/effects/spark/0.png to 3.png | a sheet of 4,
// played once | 80 x 80 | the strike's area circle, for SPARK_FLASH (0.2)
// seconds", and "Each is produced on the canvas its row states and scaled in
// code to the live shape, which areaMul and later levels grow, so the effect's
// drawn extent is the hitbox's extent on every tick it is drawn."
// specs/weapons.md ("Spark") fixes the shape: a strike "deals damage to its
// target and to every other enemy within area of the target's center", and
// specs/state.md fixes what the snapshot reports of it: "A strike's radius is
// its area", so its extent is the full diameter of that circle. WHICH frame of
// the sheet is shown belongs to the point about the sheet playing once through;
// this one holds every frame of it to the same box.
//
// THE WORLD. An isolated playing run (`isolate`): every driver switch off but
// the one the firing needs, and no other weapon held. Spark needs a target, so
// one owl stands clear of the lamplighter and well inside SPARK_RANGE (600),
// with `enemyMotion` and `enemyContact` off so it neither moves nor touches
// anything; its 2000 health outlasts a level-1 strike's 15 many times over, so
// the strike is read against an enemy that is still there. Spark is held at
// level 1, whose amount is 1, so the firing tick lands exactly one strike.
//
// WHAT IS READ. On every tick the strike zone is in the snapshot, the blit
// under `sprites/effects/spark/` nearest the point the camera formula gives its
// center: its center is that point and its box is the zone's own diameter. Then
// the ticks after the zone is gone, on which no frame of the sheet is blitted
// at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A level-1 strike is 80 units
// across and lands 300 units from the lamplighter, so an effect drawn at the
// lamplighter, or at the sheet's produced canvas against a grown hitbox, misses
// by far more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  ENEMIES,
  SPARK_FLASH,
  SPARK_LEVELS,
  SPARK_RANGE,
  ticksFor,
} from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  zonesOfKind,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the owl stands: well inside SPARK_RANGE and clear of everything. */
const OWL_AT = { x: 300, y: 0 };

/** The level held: amount 1, so the firing tick lands one strike. */
const LEVEL = 1;

/** The ticks the flash gives the shape, with the sweep's two ticks of slack. */
const BOUND = ticksFor(SPARK_FLASH) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a strike frame over its area circle for as long as the strike is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  assertEqual(SPARK_LEVELS[LEVEL - 1].amount, 1, "Spark's amount at level 1");
  assertEqual(
    Math.hypot(OWL_AT.x, OWL_AT.y) < SPARK_RANGE,
    true,
    "the owl's distance from the lamplighter, against SPARK_RANGE",
  );
  assertEqual(
    ENEMIES.owl.hp > SPARK_LEVELS[LEVEL - 1].damage,
    true,
    "an owl's health against a level-1 strike's damage",
  );
  spawnEnemyAt(h, "owl", OWL_AT.x, OWL_AT.y);
  const slot = holdWeapon(h, "spark", LEVEL);
  armWeapon(h, slot);

  await captureReplay(h, "effect", async () => {
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "strike"),
      1,
      "the strikes the firing tick landed",
    );
    await watchLife(
      h,
      "spark",
      (snapshot) => {
        const strike = zonesOfKind(snapshot, "strike")[0];
        return strike === undefined ? undefined : circleOf(strike);
      },
      "the Spark strike",
      BOUND,
    );
  });
});

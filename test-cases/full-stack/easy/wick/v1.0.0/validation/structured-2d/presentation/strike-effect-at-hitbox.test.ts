// presentation/strike-effect-at-hitbox — Spark's strike sheet is painted over
// the strike's area circle, for exactly as long as the zone is live.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// strike is "a sheet of `4`, played once" under
// `assets/sprites/effects/spark/0.png` to `3.png`, drawn over "the strike's
// `area` circle, for `SPARK_FLASH` (`0.2`) seconds", and each effect is "scaled
// in code to the live shape ... so the effect's drawn extent is the hitbox's
// extent on every tick it is drawn". `specs/state.md`: "A strike's `radius` is
// its `area`", so the zone's extent across is twice the radius the snapshot
// reports. WHICH frame of the sheet is up is the play-once item's question;
// this one asks only that SOME frame of Spark's own sheet is there, at the
// shape.
//
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up. A strike drawn at the produced canvas's fixed
// `80 x 80` whatever the area, drawn on the lamplighter instead of on its
// target, or left drawn after the flash, sits outside.
//
// THE WORLD, AND WHY. An isolated world holding Spark alone at level 1 and one
// hound. `specs/weapons.md` makes Spark need a target: "On firing, `amount`
// strikes land, each on a distinct enemy chosen uniformly at random among the
// live enemies within `SPARK_RANGE` (`600`) of the player's center", and the
// level-1 row's `amount` is `1`, so one hound at 200 units is the only
// candidate and exactly one strike lands, on it. A hound is the enemy read
// because its `hp` of `120` in `ENEMIES` survives the row's `15` damage, so no
// death, no gem, and no death puff arrive on top of the flash. `enemyMotion`
// and `enemyContact` stay off, so the hound holds its place and lands no hit.
// The strike's `ttl` is `SPARK_FLASH` (12 ticks) against Spark's level-1
// cooldown of `2.0` seconds (120 ticks), so no second strike falls inside the
// trace.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemy,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertDrawnOverShape,
  circleShape,
  traceEffect,
  type Shape,
} from "./effects";
import { effectFiles } from "./sprites";

/** Where the hound stands: well inside `SPARK_RANGE` and inside the view. */
const TARGET = { x: 200, y: 0 };

/** The one live strike, as its area circle. */
function strike(snapshot: WickSnapshot): Shape | null {
  const [zone] = zonesOfKind(snapshot, "strike");
  return zone === undefined ? null : circleShape(zone);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a spark sheet frame over the strike's area circle for its flash", async () => {
  isolate(h);
  placeEnemy(h, "hound", TARGET.x, TARGET.y);
  const slot = holdWeapon(h, "spark", 1);
  assertNull(strike(h.snapshot()), "a strike before the weapon has fired");
  armWeapon(h, slot);

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, strike, { maxTicks: 60 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("spark"), "Spark strike");
});

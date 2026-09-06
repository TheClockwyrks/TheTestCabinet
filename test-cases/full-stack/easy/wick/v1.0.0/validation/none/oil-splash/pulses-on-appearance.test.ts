// Wick — oil-splash/pulses-on-appearance: a puddle pulses on the tick it
// appears.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`): it pulses on
// the tick it appears and on every `OIL_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." ("Persistent
// effects") "A pulsing effect ... damages every enemy overlapping it on each
// pulse tick." `specs/world.md` (phase 6): "every projectile and zone hits,
// this tick's new ones included, a new one hitting at the position it was
// created at". ("Shapes and overlap") "Two circles overlap when the distance
// between their centers is less than the sum of their radii", and a moth is a
// circle of radius `10` (`specs/enemies.md`) standing at distance `0` from a
// puddle of radius `50`. So a moth at the landing point has `hp` below what it
// was posed with on the firing tick itself.
//
// THE POSE. The shared `fireOntoEnemy` (`oil-splash/stage.ts`): an isolated
// night with the level-1 puddle's landing point posed through
// `setNextPuddleOffset` and the moth posed at that point before the firing
// tick. Every faculty but
// `weaponFire` is held, so the moth stands where it was posed and nothing else
// touches it. A moth is the probe because its `5` hp outlives the row's
// `4` damage, so the reading is a lowered `hp` rather than a death.
//
// TOLERANCE. None on the tick: the pulse is on the firing tick or it is not.
// The reading is one direction, `hp` below the posed value; how much it fell
// by is the row's figure and `row-1`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  mustEnemy,
  type Harness,
} from "../harness";
import { fireOntoEnemy } from "./stage";

/** The level fired: row 1, one puddle, damage `4` against a moth's `5` hp. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers the hp of a moth at the landing point on the firing tick", async () => {
  const landed = await fireOntoEnemy(h, "moth", LEVEL);
  await captureStill(h, "first");

  const moth = mustEnemy(landed.firing.after, landed.enemy.id);
  assertLessThan(
    moth.hp,
    landed.enemy.hp,
    `the moth's hp on the firing tick, posed at ${landed.enemy.hp} under the puddle's landing point`,
  );
});

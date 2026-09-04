// Wick — oil-splash/puddle-stays: a puddle stays where it landed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a circle of `radius` that stays where it landed for `duration`
// seconds and then vanishes." ("Persistent effects") a puddle is "a shape that
// stays in the world for a while". `specs/instrumentation.md` ("Snapshot
// shape"): "Every zone's `x`, `y` is its center." So the center a puddle
// reports on the tick it landed is the center it reports on every later tick
// of its life, wherever the lamplighter has gone; the aura and the lanterns
// are the zones the specification places about the lamplighter every tick,
// and a puddle is neither.
//
// WHAT IS READ. The puddle's `x` and `y` on each of sixty ticks after the
// firing, against the center the firing tick reported, while the
// lamplighter's center is moved `MOVE_STEP` (`3`) units along `+x` before each
// tick, the step one tick of walking covers. `setPlayerPosition` is the pose
// that moves the lamplighter without the keyboard: "Sets the lamplighter's
// center to `(x, y)`. Nothing else moves: the camera follows on the next
// render, and the aura and lanterns follow on the next tick", so a build that
// carries its puddles with the player is caught on the next tick by this
// reading and a build with a broken key is not.
//
// THE POSE. An isolated night with Oil Splash alone at level 1, fired once
// through the shared `fireOil`; then `weaponFire` off, so nothing fires again,
// and `effectMotion` on, so the faculty that moves the world's effects is
// running under the reading rather than held. No enemy is posed, so the puddle
// pulses on nothing.
//
// TOLERANCE. `POSITION_TOL` on each coordinate against the landing center a
// build copied from its draw: a puddle that stays does not accumulate anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  enable,
  isolate,
  mustZone,
  type Harness,
} from "../harness";
import { centerOf, fireOil, puddlesOf } from "./stage";

/** The level fired: row 1, one puddle. */
const LEVEL = 1;

/** How many ticks the lamplighter walks while the puddle is read: one second. */
const WALK_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a puddle's x and y tick over tick while the lamplighter walks away", async () => {
  await isolate(h);

  const walked = await captureReplay(h, "stayed", async () => {
    const fired = await fireOil(h, LEVEL);
    const puddles = puddlesOf(fired);
    assertEqual(
      puddles.length,
      1,
      "Oil Splash puddles the firing tick created",
    );
    const landed = centerOf(puddles[0]!);
    const id = puddles[0]!.id;
    await disable(h, "weaponFire");
    await enable(h, "effectMotion");

    const start = fired.after.run.player;
    const centers: { tick: number; x: number; y: number }[] = [];
    for (let step = 1; step <= WALK_TICKS; step += 1) {
      await h.debug.setPlayerPosition(start.x + MOVE_STEP * step, start.y);
      const after = await h.step(1);
      const puddle = mustZone(after, id);
      centers.push({ tick: step, x: puddle.x, y: puddle.y });
    }
    return { landed, centers };
  });

  assertEqual(
    walked.centers.length,
    WALK_TICKS,
    "ticks the puddle was read on",
  );
  for (const center of walked.centers) {
    assertNear(
      center.x,
      walked.landed.x,
      POSITION_TOL,
      `the puddle's x on tick ${center.tick} after landing`,
    );
    assertNear(
      center.y,
      walked.landed.y,
      POSITION_TOL,
      `the puddle's y on tick ${center.tick} after landing`,
    );
  }
});

// Wick — halo/aura-centered-on-player: the aura reads the lamplighter's center
// on every tick, however the lamplighter moves.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): the aura is "a
// circle of `radius` centered on the player's center every tick".
// `specs/world.md` (phase 5, "The placement, on every `playing` tick"): "the
// aura's center ... [is] placed about the lamplighter's position of this
// tick", after phase 2, where "The lamplighter moves". `specs/instrumentation.md`
// ("Snapshot shape") has "Every zone's `x`, `y` is its center". So on every
// tick of a hold that moves the lamplighter, the aura's `x` and `y` read the
// `player.x` and `player.y` of that same tick.
//
// THE POSE. An isolated night with Halo held at level 1 and one tick stepped
// so the aura exists, then `ArrowRight` held for `HOLD_TICKS` frames, one frame
// per tick: `specs/controls.md` binds `right` to it, and `specs/world.md`
// ("Movement") moves the lamplighter by `moveSpeed × TICK_DT`, `MOVE_STEP`
// (`3`) units, on each tick it is held. Every faculty is held, `weaponFire`
// included: the requirement is where the aura is placed, not whether it
// pulses, and there is nothing to pulse on. The key is a real key event
// through Chromium's input pipeline, because the keyboard belongs to the
// runtime layer the build wrote. That the hold moved the lamplighter at all is
// read as a precondition of the pose, so a build whose aura sits still while
// the lamplighter does cannot pass by standing still.
//
// TOLERANCE. `POSITION_TOL` on each coordinate: the aura's center is the
// player's position copied on the tick, and the position itself is a figure
// integrated over ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  holdWeapon,
  isolate,
  mustZone,
  player,
  type Harness,
} from "../harness";
import { HALO, auraOf } from "./stage";

/** The level Halo is held at; the row is another point's business. */
const LEVEL = 1;

/** Half a second of the hold, read one tick at a time. */
const HOLD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the aura's center at the lamplighter's center on every tick of a hold that moves it", async () => {
  await isolate(h);
  await holdWeapon(h, HALO, LEVEL);
  const placed = await h.step(1);
  const aura = auraOf(placed, "after the first tick Halo is held");

  const ticks = await captureReplay(h, "centered", () =>
    holdKeysWatching(h, ["ArrowRight"], HOLD_TICKS),
  );

  assertEqual(ticks.length, HOLD_TICKS, "the frames the hold ran");
  const last = ticks[ticks.length - 1]!;
  assertGreaterThan(
    player(last).x - player(placed).x,
    0,
    "the lamplighter's displacement along x over the ArrowRight hold",
  );
  for (const [index, snapshot] of ticks.entries()) {
    const tick = index + 1;
    const at = player(snapshot);
    const now = mustZone(snapshot, aura.id);
    assertNear(
      now.x,
      at.x,
      POSITION_TOL,
      `the aura's x against the lamplighter's on tick ${tick} of the hold`,
    );
    assertNear(
      now.y,
      at.y,
      POSITION_TOL,
      `the aura's y against the lamplighter's on tick ${tick} of the hold`,
    );
  }
});

// Wick — lantern/revolution: a lantern revolves at LANTERN_ANGULAR_SPEED,
// clockwise.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "From the next tick they revolve at
//     `LANTERN_ANGULAR_SPEED` (`180`) degrees per second clockwise, so lantern
//     `i` sits at angle `i × 360 / amount + LANTERN_ANGULAR_SPEED × t` after
//     `t` seconds", on "a circle of radius `orbit` around the player's
//     center"; row 1 has orbit `90` and amount `1`, so the one lantern starts
//     at `0` degrees.
//   - `specs/state.md` (`ZoneState`): "each tick places it at that angle,
//     advanced by `LANTERN_ANGULAR_SPEED` (`180`) `× TICK_DT` degrees", 3
//     degrees a tick, so after tick `k` since the firing the lantern is at
//     `3 × k` degrees, and after 30 ticks at `90`.
//   - `specs/weapons.md` ("The nearest enemy"): "positive angles turning
//     toward `+y`, which is clockwise on screen", so `90` degrees is the
//     point `orbit` along `+y` from the player's center.
//   - `specs/instrumentation.md` (The driver switches): the lanterns revolve
//     while `effectMotion` is on; `specs/world.md` ("One tick"), phase 6: only
//     a zone "that existed before this tick" moves, so the firing tick itself
//     turns nothing.
//
// WHAT IS READ. The lantern's center after each of the 30 ticks following the
// firing, against the point `orbit` from the lamplighter's center at
// `3 × k` degrees: after tick 30, 90 units along +y. Every tick is read
// rather than the last alone, so a build turning the other way, at another
// rate, or by whole multiples cannot land on the same point by coincidence.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1, one lantern, so
// which lantern is read is never in doubt; nothing on the field; every switch
// off but `weaponFire` and `effectMotion`, the two the firing and the
// revolution need. The lamplighter stands still, so the circle's center is
// fixed and the reading is the angle alone.
//
// TOLERANCE. `MOTION_TOLERANCE` on each coordinate: an angle integrated tick
// by tick, then a product with a cosine or a sine, read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin, fail } from "../assert";
import {
  LANTERN_ANGULAR_SPEED,
  MOTION_TOLERANCE,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  pointAt,
  zoneById,
  type Harness,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: one lantern. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** How long the lantern is watched: half a second, a quarter turn. */
const WATCH_SECONDS = 0.5;

/** The ticks watched after the firing tick: 30. */
const WATCH_TICKS = ticksFor(WATCH_SECONDS);

/** The degrees one tick turns a lantern: 180 × 1/60 = 3. */
const DEGREES_PER_TICK = LANTERN_ANGULAR_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns the lantern 3 degrees a tick toward +y, 90 degrees after 30 ticks", async () => {
  assertEqual(ROW.amount, 1, "the level-1 row's amount");
  const orbit = armLantern(h, LEVEL);
  enable(h, "effectMotion");

  const trace = await captureReplay(h, "revolving", async () => {
    const fired = await h.tick(1);
    const set = lanternsOf(fired);
    assertEqual(set.length, 1, "Lantern lanterns after the firing");
    return { id: set[0].id, seen: await h.trace(WATCH_TICKS) };
  });

  trace.seen.forEach((snapshot, index) => {
    const tick = index + 1;
    const lantern = zoneById(snapshot, trace.id);
    if (lantern === undefined) fail(`the lantern after tick ${tick}`, "gone");
    const expected = pointAt(orbit.player, ROW.orbit, DEGREES_PER_TICK * tick);
    assertWithin(
      lantern.x,
      expected.x,
      MOTION_TOLERANCE,
      `the lantern's x after tick ${tick}, at ${DEGREES_PER_TICK * tick} degrees`,
    );
    assertWithin(
      lantern.y,
      expected.y,
      MOTION_TOLERANCE,
      `the lantern's y after tick ${tick}, at ${DEGREES_PER_TICK * tick} degrees`,
    );
  });
});

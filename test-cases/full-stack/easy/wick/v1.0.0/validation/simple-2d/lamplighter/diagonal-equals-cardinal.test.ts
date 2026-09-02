// lamplighter/diagonal-equals-cardinal — diagonal movement is as fast as
// cardinal.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions ... normalized
// to unit length when the sum is non-zero. The velocity is that direction times
// moveSpeed, and each tick the position advances by the velocity times TICK_DT.
// Diagonal movement is therefore exactly as fast as cardinal movement". With
// ArrowRight and ArrowDown held together the sum (1, 1) normalizes to (1 / √2,
// 1 / √2), so every tick advances each of x and y by MOVE_SPEED × TICK_DT / √2
// = 3 × 0.7071 units and the step's length is 3 units, the cardinal step; one
// second, round(1 × TICK_HZ) = 60 ticks (specs/world.md, "Timers"), covers 180
// units along the diagonal.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon or passive held (no Bellows, so moveSpeed is MOVE_SPEED), every driver
// switch off. The lamplighter stands at the origin.
//
// WHAT IS READ. The snapshot after each of the 60 held ticks: each tick's step
// in x and in y against the normalized component, and the whole second's
// displacement against 180 units of length. A build that adds the two unit
// vectors without normalizing steps 3 on each axis and 4.24 along the diagonal,
// and misses on every reading.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a position
// integrated tick by tick: 1 / √2 is a quotient of exact figures that a build
// may form as 1 / Math.hypot(1, 1) or Math.SQRT1_2, which agree to 1e-16, and
// sixty steps accumulate under 1e-13.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  BINDINGS,
  MOTION_TOLERANCE,
  MOVE_SPEED,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first keys specs/controls.md binds to `right` and `down`. */
const KEYS = [BINDINGS.right[0], BINDINGS.down[0]];

/** One second of game time, in ticks, under the timer rule. */
const HELD_TICKS = ticksFor(1);

/** One tick's step along each axis: MOVE_SPEED × TICK_DT / √2. */
const COMPONENT = (MOVE_SPEED * TICK_DT) / Math.SQRT2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter 180 units along the normalized diagonal in one held second", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the keys are held on");
  assertLength(posed.run.passives, 0, "passives held, so no Bellows");
  const start = posed.run.player;

  const seen = await captureReplay(h, "diagonal", async () => {
    for (const key of KEYS) h.holdKey(key);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      for (const key of KEYS) h.releaseKey(key);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held keys");
  let previous = { x: start.x, y: start.y };
  seen.forEach((snapshot, i) => {
    const tick = i + 1;
    const { player } = snapshot.run;
    assertWithin(
      player.x - previous.x,
      COMPONENT,
      MOTION_TOLERANCE,
      `the step in player.x on held tick ${tick}`,
    );
    assertWithin(
      player.y - previous.y,
      COMPONENT,
      MOTION_TOLERANCE,
      `the step in player.y on held tick ${tick}`,
    );
    previous = { x: player.x, y: player.y };
  });
  const last = seen[seen.length - 1].run.player;
  assertWithin(
    Math.hypot(last.x - start.x, last.y - start.y),
    MOVE_SPEED,
    MOTION_TOLERANCE,
    `the distance covered over one held second of ${KEYS.join(" + ")}`,
  );
});

// lamplighter/world-unbounded — no edge stops the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The plane"): "The world is
// an unbounded plane ... nothing bounds how far from it the lamplighter may
// walk", and ("Movement"): "The world is unbounded, so no edge stops the
// lamplighter." The step is the movement rule's: with ArrowRight alone held the
// direction is (1, 0), and every tick advances x by MOVE_SPEED × TICK_DT = 3
// units with no Bellows held, wherever the lamplighter stands. One second is
// round(1 × TICK_HZ) = 60 ticks (specs/world.md, "Timers"), 180 units.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon or passive held, every driver switch off. The lamplighter is posed
// far from the origin at (5000, -5000), the point the item names, well past
// several stages' width in each axis, and the pose is read back: a surface
// that does not answer it fails the point here rather than measuring a walk
// at the origin.
//
// WHAT IS READ. Every tick's step in x over one held second, and the second's
// whole displacement, exactly as `move-speed` reads them at the origin; y is
// read as held. A build that clamps the lamplighter to the stage, to a fixed
// arena, or to any distance from the origin stops short and misses on the
// steps that follow.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a position
// integrated tick by tick. At 5000 a double still carries thirteen decimal
// digits past the unit, so the far position adds nothing to the rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  BINDINGS,
  FIGURE_TOLERANCE,
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

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Where the lamplighter is posed: the far point the item names. */
const FAR_X = 5000;
const FAR_Y = -5000;

/** One second of game time, in ticks, under the timer rule. */
const HELD_TICKS = ticksFor(1);

/** What one tick of the base speed covers: MOVE_SPEED × TICK_DT, 3 units. */
const STEP = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter 3 units a tick at (5000, -5000) as at the origin", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  assertLength(posed.run.passives, 0, "passives held, so no Bellows");
  h.debug.setPlayerPosition(FAR_X, FAR_Y);
  const start = h.snapshot().run.player;
  assertWithin(start.x, FAR_X, FIGURE_TOLERANCE, "player.x as posed");
  assertWithin(start.y, FAR_Y, FIGURE_TOLERANCE, "player.y as posed");

  const seen = await captureReplay(h, "far", async () => {
    h.holdKey(KEY);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      h.releaseKey(KEY);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held key");
  let previousX = start.x;
  seen.forEach((snapshot, i) => {
    const tick = i + 1;
    assertWithin(
      snapshot.run.player.x - previousX,
      STEP,
      MOTION_TOLERANCE,
      `the step in player.x on held tick ${tick}, from ${previousX}`,
    );
    assertWithin(
      snapshot.run.player.y,
      start.y,
      MOTION_TOLERANCE,
      `player.y on held tick ${tick}`,
    );
    previousX = snapshot.run.player.x;
  });
  assertWithin(
    seen[seen.length - 1].run.player.x - start.x,
    MOVE_SPEED,
    MOTION_TOLERANCE,
    `player.x's change over one held second of ${KEY}, from ${FAR_X}`,
  );
});

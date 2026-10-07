// lamplighter/move-speed — the lamplighter moves at MOVE_SPEED.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter"): "Base
// move speed, units per second: MOVE_SPEED, 180", and ("Movement"): "The
// velocity is that direction times moveSpeed, and each tick the position
// advances by the velocity times TICK_DT ... moveSpeed is MOVE_SPEED times the
// speed multiplier specs/passives.md defines, so with no Bellows held it is
// MOVE_SPEED." specs/overview.md fixes TICK_DT at 1 / 60, so under ArrowRight
// alone the direction is (1, 0) and every tick advances x by exactly MOVE_SPEED
// × TICK_DT = 3 units; one second of game time is round(1 × TICK_HZ) = 60 ticks
// (specs/world.md, "Timers"), which carry the lamplighter exactly 180 units.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, no passive held (so no Bellows, and moveSpeed is the base),
// every driver switch off. The lamplighter stands at the origin facing right.
//
// WHAT IS READ. The snapshot after each of the 60 held ticks: every tick's step
// in x, and the whole second's displacement. Both are decided, since a build
// that reaches 180 by uneven steps and one that steps 3 but stops short both
// miss the rule. y is read as held, because a rate read along x means nothing
// if the walk drifted.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a position
// integrated tick by tick: a step of 180 / 60 is exact in binary or off by one
// rounding, and sixty of them accumulate under 1e-13.

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

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

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

it("moves the lamplighter 180 units in one held second, 3 units a tick", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  assertLength(posed.run.passives, 0, "passives held, so no Bellows");
  const start = posed.run.player;

  const seen = await captureReplay(h, "second", async () => {
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
      `the step in player.x on held tick ${tick}`,
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
    `player.x's change over one held second of ${KEY}`,
  );
});

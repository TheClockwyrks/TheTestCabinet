// passives/bellows-speed-mul — Bellows multiplies the lamplighter's move speed
// by 1 + BELLOWS_SPEED_PER_LEVEL per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows", with
// BELLOWS_SPEED_PER_LEVEL 0.1, so Bellows 2 gives 1.2; and ("Move speed") "The
// lamplighter's move speed is MOVE_SPEED (180) times `speedMul`, in units per
// second, and the movement rule in `specs/world.md` integrates that speed each
// tick", so moveSpeed is 180 × 1.2 = 216. specs/world.md ("Movement"): "The
// velocity is that direction times `moveSpeed`, and each tick the position
// advances by the velocity times TICK_DT", so one tick of a held `right`
// advances x by 216 / 60 = 3.6 and one second, round(1 × 60) = 60 ticks
// (specs/world.md, "Timers"), carries the lamplighter 216 units.
// specs/instrumentation.md ("Snapshot shape") lists `moveSpeed` among the
// derived fields, "MOVE_SPEED (180) × (1 + BELLOWS_SPEED_PER_LEVEL (0.1) × the
// Bellows level held)".
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Bellows alone at level 2 in the first passive slot, every driver switch off.
// The lamplighter stands at the origin, and the only key held is the first
// specs/controls.md binds to `right`.
//
// WHAT IS READ. `moveSpeed` off the snapshot, then the step in x after each of
// the 60 held ticks, and the whole second's displacement. All three are read: a
// build that reports 216 while walking at 180, and one that walks at 216
// without reporting it, each miss a reading. y is read as held, because a rate
// along x means nothing if the walk drifted.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on `moveSpeed`, a product of two stated
// figures, and MOTION_TOLERANCE (1e-6) on the positions, integrated tick by
// tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  BINDINGS,
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  TICK_DT,
  moveSpeedFor,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Bellows at level 2. */
const HELD: HeldPassives = { bellows: 2 };

/** 180 × (1 + 0.1 × 2) = 216 units per second. */
const SPEED = moveSpeedFor(HELD);

/** One tick of that speed: 216 / 60 = 3.6 units. */
const STEP = SPEED * TICK_DT;

/** One second of game time, in ticks, under the timer rule. */
const HELD_TICKS = ticksFor(1);

/** The first key specs/controls.md binds to `right`. */
const KEY = BINDINGS.right[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads moveSpeed 216 with Bellows 2 held and walks 3.6 units a tick", async () => {
  const posed = isolate(h);
  holdPassives(h, HELD);
  const start = { ...posed.run.player };
  assertWithin(
    h.snapshot().run.moveSpeed,
    SPEED,
    FIGURE_TOLERANCE,
    "moveSpeed with Bellows 2 held",
  );

  const seen = await captureReplay(h, "speed", async () => {
    h.holdKey(KEY);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      h.releaseKey(KEY);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held key");
  let previousX = start.x;
  seen.forEach((snapshot, index) => {
    const { player } = snapshot.run;
    assertWithin(
      player.x - previousX,
      STEP,
      MOTION_TOLERANCE,
      `the step in player.x on held tick ${index + 1}`,
    );
    assertWithin(
      player.y,
      start.y,
      MOTION_TOLERANCE,
      `player.y on held tick ${index + 1}`,
    );
    previousX = player.x;
  });
  assertWithin(
    seen[seen.length - 1].run.player.x - start.x,
    SPEED,
    MOTION_TOLERANCE,
    `player.x's change over one held second of ${KEY}`,
  );
});

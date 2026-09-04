// passives/bellows-diagonal-equals-cardinal — a diagonal walk covers the same
// ground as a cardinal one at every Bellows level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Move speed"): "The
// lamplighter's move speed is MOVE_SPEED (180) times `speedMul` ... Diagonal
// speed equals cardinal speed at every Bellows level", with
// speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows and
// BELLOWS_SPEED_PER_LEVEL 0.1, so Bellows 2 gives 216 units per second.
// specs/world.md ("Movement"): "The movement direction is the sum of the unit
// vectors of the held actions ... normalized to unit length when the sum is
// non-zero", so `right` and `down` together give (1, 1) normalized to
// (1 / √2, 1 / √2) and each tick advances x and y by 216 / 60 / √2 while the
// step's own length is 216 / 60 = 3.6, the cardinal step. One second,
// round(1 × 60) = 60 ticks, covers 216 units along the diagonal.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Bellows alone at level 2 in the first passive slot, every driver switch off.
// The lamplighter stands at the origin, and the keys held are the first
// specs/controls.md binds to `right` and to `down`.
//
// WHAT IS READ. Each tick's step in x and in y against the normalized
// component, and the whole second's displacement against 216 units of length. A
// build that scales the two unit vectors by moveSpeed without normalizing their
// sum steps 3.6 on each axis and 5.09 along the diagonal, and misses every
// reading.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a position
// integrated tick by tick; 1 / √2 is a quotient of exact figures a build may
// form as 1 / Math.hypot(1, 1) or Math.SQRT1_2, which agree to 1e-16.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  BINDINGS,
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

/** One tick's step along each axis: 216 × TICK_DT / √2. */
const COMPONENT = (SPEED * TICK_DT) / Math.SQRT2;

/** One tick's whole step, the cardinal step: 216 × TICK_DT = 3.6. */
const STEP = SPEED * TICK_DT;

/** One second of game time, in ticks, under the timer rule. */
const HELD_TICKS = ticksFor(1);

/** The first keys specs/controls.md binds to `right` and to `down`. */
const KEYS = [BINDINGS.right[0], BINDINGS.down[0]];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("walks 3.6 units a tick along the diagonal with Bellows 2 held", async () => {
  const posed = isolate(h);
  holdPassives(h, HELD);
  const start = { ...posed.run.player };

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
  seen.forEach((snapshot, index) => {
    const { player } = snapshot.run;
    const tick = index + 1;
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
    assertWithin(
      Math.hypot(player.x - previous.x, player.y - previous.y),
      STEP,
      MOTION_TOLERANCE,
      `the length of the step on held tick ${tick}`,
    );
    previous = { x: player.x, y: player.y };
  });
  const last = seen[seen.length - 1].run.player;
  assertWithin(
    Math.hypot(last.x - start.x, last.y - start.y),
    SPEED,
    MOTION_TOLERANCE,
    `the distance covered over one held second of ${KEYS.join(" + ")}`,
  );
});

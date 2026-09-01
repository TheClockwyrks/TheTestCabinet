// lamplighter/move-left — ArrowLeft moves the lamplighter left.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The lamplighter
// is moved by the four actions up, down, left, and right, each read as a held
// value on the playing screen ... The movement direction is the sum of the unit
// vectors of the held actions, up (0, -1), down (0, 1), left (-1, 0), and right
// (1, 0), normalized to unit length when the sum is non-zero. The velocity is
// that direction times moveSpeed, and each tick the position advances by the
// velocity times TICK_DT." specs/controls.md binds `left` to ArrowLeft and
// reads it "held". With ArrowLeft alone held the direction is (-1, 0), so on
// every held tick player.x falls and player.y advances by exactly 0.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so the held key is the only thing that
// can move the lamplighter, which stands at the origin as a fresh run leaves
// it.
//
// WHAT IS READ, AND IN WHICH DIRECTION. The snapshot after each of HELD_TICKS
// held ticks. This point decides the DIRECTION alone: x falls on every held
// tick and y holds. The rate belongs to `move-speed`, the key's twin to
// `key-a-moves-like-arrow-left`, and what the walk does to `facing` to
// `facing-left`.
//
// TOLERANCE. Strict on x: a fall on every tick, of any size. y is held within
// MOTION_TOLERANCE (1e-6), the case's tolerance for a position integrated tick
// by tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertWithin,
} from "../assert";
import { BINDINGS, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first key specs/controls.md binds to `left`: ArrowLeft. */
const KEY = BINDINGS.left[0];

/** Ticks the key is held: half a second, thirty readings of the direction. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter left on every tick ArrowLeft is held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  const start = posed.run.player;

  const seen = await captureReplay(h, "left", async () => {
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
    assertLessThan(
      snapshot.run.player.x,
      previousX,
      `player.x on held tick ${tick}, against the tick before`,
    );
    assertWithin(
      snapshot.run.player.y,
      start.y,
      MOTION_TOLERANCE,
      `player.y on held tick ${tick}`,
    );
    previousX = snapshot.run.player.x;
  });
});

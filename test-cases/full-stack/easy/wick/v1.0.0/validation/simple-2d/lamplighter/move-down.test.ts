// lamplighter/move-down — ArrowDown moves the lamplighter down.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The lamplighter
// is moved by the four actions up, down, left, and right, each read as a held
// value on the playing screen ... The movement direction is the sum of the unit
// vectors of the held actions, up (0, -1), down (0, 1), left (-1, 0), and right
// (1, 0), normalized to unit length when the sum is non-zero. The velocity is
// that direction times moveSpeed, and each tick the position advances by the
// velocity times TICK_DT." specs/controls.md binds `down` to ArrowDown and
// reads it "held on playing". With ArrowDown alone held the direction is (0,
// 1), so on every held tick player.y rises (y increases downward,
// specs/world.md "The plane") and player.x advances by exactly 0.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so the held key is the only thing that
// can move the lamplighter, which stands at the origin as a fresh run leaves
// it.
//
// WHAT IS READ, AND IN WHICH DIRECTION. The snapshot after each of HELD_TICKS
// held ticks. This point decides the DIRECTION alone: y rises on every held
// tick and x holds. The rate belongs to `move-speed` and the key's twin to
// `key-s-moves-like-arrow-down`.
//
// TOLERANCE. Strict on y: a rise on every tick, of any size. x is held within
// MOTION_TOLERANCE (1e-6), the case's tolerance for a position integrated tick
// by tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertWithin,
} from "../assert";
import { BINDINGS, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first key specs/controls.md binds to `down`: ArrowDown. */
const KEY = BINDINGS.down[0];

/** Ticks the key is held: half a second, thirty readings of the direction. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter down on every tick ArrowDown is held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  const start = posed.run.player;

  const seen = await captureReplay(h, "down", async () => {
    h.holdKey(KEY);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      h.releaseKey(KEY);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held key");
  let previousY = start.y;
  seen.forEach((snapshot, i) => {
    const tick = i + 1;
    assertGreaterThan(
      snapshot.run.player.y,
      previousY,
      `player.y on held tick ${tick}, against the tick before`,
    );
    assertWithin(
      snapshot.run.player.x,
      start.x,
      MOTION_TOLERANCE,
      `player.x on held tick ${tick}`,
    );
    previousY = snapshot.run.player.y;
  });
});

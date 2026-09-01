// controls/bindings-by-code — a binding matches the physical key.
//
// WHAT THIS DECIDES. One thing: `BINDINGS` are matched against
// `KeyboardEvent.code`, the physical key, so a `keydown` whose `code` is
// `KeyW` drives `up` whatever character its `key` reports. A build that
// matched `key` instead would see a `z` and move nothing.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`BINDINGS` maps each to the
//   `KeyboardEvent.code` values that fire it", and "`up` | `ArrowUp`, `KeyW`
//   | held on `playing`, edge elsewhere | moves the lamplighter up".
//   specs/world.md ("Movement"): the direction of `up` is `(0, -1)`, "The
//   velocity is that direction times `moveSpeed`, and each tick the position
//   advances by the velocity times `TICK_DT`", with `MOVE_SPEED` 180: 3
//   units a tick, 60 over 20 ticks.
//
// THE DRIVE. An isolated world with the lamplighter at the origin. The event
// dispatched at the engine's input seam carries `code` `KeyW` and `key` `z`,
// exactly what the physical W key sends on an AZERTY layout, and is held
// across 20 frames on `playing`, one tick each. A build matching the physical
// key reads `y` at −60; one matching the character reads 0.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's bound for a position reached by
// integrating a tick at a time; the wrong answer is 60 units off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The physical key W, as an AZERTY keyboard reports it. */
const CODE = "KeyW";
const KEY = "z";

/** Ticks the key is held for: a third of a second, 60 units. */
const TICKS = 20;

/** Twenty ticks of `MOVE_SPEED × TICK_DT` upward, `up` being `(0, -1)`. */
const EXPECTED_Y = -MOVE_SPEED * TICK_DT * TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the lamplighter up for a keydown whose code is KeyW and whose key is z", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.y, 0, "player.y before the hold");

  h.holdKey(CODE, { key: KEY });
  let after;
  try {
    after = await h.tick(TICKS);
  } finally {
    h.releaseKey(CODE);
  }
  captureStill(h, "code");

  assertNear(
    after.run.player.y,
    EXPECTED_Y,
    MOTION_EPS,
    "player.y after 20 ticks of the physical W key",
  );
});

// controls/held-until-every-key-released — an action stays held while any of
// its keys is down.
//
// WHAT THIS DECIDES. One thing: with both keys of `up` down, releasing one of
// them leaves `up` held, so the lamplighter keeps moving up until the other
// is released too. That `up` moves it at all is the lamplighter's business
// and the precondition here.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` |
//   held on `playing`", "The two keys bound to an action are interchangeable",
//   and "The Structured 2D engine delivers the input, and its documentation
//   defines the API."
//   The engine's `engine/input.md`: "The engine owns the keyboard and the
//   pointer: each action resolves to a single number", read as "`value(name)`
//   ... The action's resolved magnitude. A `"digital"` action reports `0` or
//   `1`, with every non-zero magnitude quantized to `1`"; both of an action's
//   keys drive that one number, which is why "Pressing a second key bound to
//   an already-held action is not a new press".
//   specs/world.md ("Movement"): the direction of `up` is `(0, -1)`, "each
//   tick the position advances by the velocity times `TICK_DT`", with
//   `MOVE_SPEED` 180: 3 units a tick.
//
// THE DRIVE. An isolated world with the lamplighter at the origin. `ArrowUp`
// and `KeyW` are both pressed and held for 10 ticks; `KeyW` alone is
// released and 10 more ticks run, which is the reading under test: a build
// that dropped the action with the first release reads −30 here, and one
// holding it by its second key reads −60. Then `ArrowUp` is released and 10
// more ticks run, which must add nothing, so a build that never released the
// action fails on that line rather than passing on the first.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's bound for a position reached by
// integrating a tick at a time; the nearest wrong answer is 30 units off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** Ticks of each of the three spans: both keys, one key, no key. */
const SPAN = 10;

/** One span of `up`: 30 units, `up` being `(0, -1)`. */
const SPAN_Y = -MOVE_SPEED * TICK_DT * SPAN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the lamplighter moving up after KeyW is released while ArrowUp stays down", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.y, 0, "player.y before the hold");

  const { oneKey, noKey } = await captureReplay(h, "held", async () => {
    h.holdKey("ArrowUp");
    h.holdKey("KeyW");
    try {
      const bothKeys = await h.tick(SPAN);
      assertNear(
        bothKeys.run.player.y,
        SPAN_Y,
        MOTION_EPS,
        "player.y after 10 ticks with both keys down",
      );
      h.releaseKey("KeyW");
      const oneKey = await h.tick(SPAN);
      h.releaseKey("ArrowUp");
      const noKey = await h.tick(SPAN);
      return { oneKey, noKey };
    } finally {
      h.releaseKey("KeyW");
      h.releaseKey("ArrowUp");
    }
  });

  assertNear(
    oneKey.run.player.y,
    2 * SPAN_Y,
    MOTION_EPS,
    "player.y after 10 more ticks with ArrowUp alone still down",
  );
  assertNear(
    noKey.run.player.y,
    2 * SPAN_Y,
    MOTION_EPS,
    "player.y after 10 more ticks with both keys released",
  );
});

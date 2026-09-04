// controls/bindings-by-code — a binding matches the physical key.
//
// WHAT THIS DECIDES. One thing: `BINDINGS` match `KeyboardEvent.code`, so a
// `keydown` whose `code` is `KeyW` drives `up` whatever character its `key`
// reports. That `up` moves the lamplighter up at the stated rate is
// lamplighter/move-up and lamplighter/move-speed, and that `KeyW` is bound to
// `up` at all is lamplighter/key-w-moves-like-arrow-up; this point is WHICH
// field of the event the binding reads.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`BINDINGS` maps each to the
//   `KeyboardEvent.code` values that fire it", and "`up` | `ArrowUp`, `KeyW` |
//   held on `playing` ... moves the lamplighter up".
//   The engine's input documentation, which specs/controls.md defers to:
//   "`keys` are `KeyboardEvent.code` values rather than `key` values, so a
//   binding is layout-independent: `KeyW` is the same physical key on QWERTY
//   and AZERTY", and its listeners read "`KeyboardEvent.code` and
//   `KeyboardEvent.repeat`" alone.
//   specs/world.md ("Movement"): `up` is `(0, -1)`, so the lamplighter's `y`
//   falls while `up` is held.
//
// THE DRIVE. An isolated run (`isolate`: the empty night, every driver switch
// off), the lamplighter read back at rest. A `keydown` with `code` `KeyW` and
// `key` `"z"`, the character the same physical key reports under another
// layout, is dispatched at the engine's own event target and held across 30
// frames, then released. A build that matched on `key` never sees `up` and
// the lamplighter stays put.
//
// THE TOLERANCE. `MOVED_MIN`, 1 unit of upward travel over 30 held ticks. The
// ideal is 30 × 180 / 60 = 90 units, and the bound is deliberately far below
// it: it exists only to establish that the key was READ, and the rate is
// graded by lamplighter/move-speed, which must be the point that fails when
// the rate is wrong. One tick of movement is 3 units, so a build that read
// the key even once clears the bound, and one that never did moves 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** Frames the key is held across: the case's minimum span for a movement reading. */
const HELD_FRAMES = 30;

/** The character the event reports: not `w`, so a `key` match finds nothing. */
const OTHER_KEY = "z";

/** How far up the lamplighter must at least have travelled: under one tick's 3 units. */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the lamplighter up on a keydown whose code is KeyW and whose key is another character", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");

  h.holdKey("KeyW", { key: OTHER_KEY });
  let after;
  try {
    after = await h.tick(HELD_FRAMES);
  } finally {
    h.releaseKey("KeyW");
  }
  captureStill(h, "code");

  assertGreaterThanOrEqual(
    posed.run.player.y - after.run.player.y,
    MOVED_MIN,
    `units travelled up over ${HELD_FRAMES} frames of code KeyW, key "${OTHER_KEY}"`,
  );
});

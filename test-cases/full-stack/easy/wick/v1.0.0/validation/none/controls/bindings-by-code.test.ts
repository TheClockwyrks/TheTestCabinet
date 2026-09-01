// controls/bindings-by-code — a binding matches the physical key.
//
// WHAT THIS DECIDES. One thing: the keyboard layer binds by `KeyboardEvent.code`
// and not by `KeyboardEvent.key`. A `keydown` whose `code` is `KeyW` and whose
// `key` is some other character moves the lamplighter up on `playing`.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): "That layer maps each key in
//   `BINDINGS` to its action in `ACTIONS` by `KeyboardEvent.code`, so a binding
//   is a physical key whatever the keyboard layout".
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` | held
//   on `playing`, edge elsewhere | moves the lamplighter up".
//   specs/world.md ("Movement"): `up` is `(0, -1)`, "each tick the position
//   advances by the velocity times `TICK_DT`", `MOVE_STEP` `3` a tick.
//   specs/instrumentation.md ("What the runtime provides instead"): "a
//   dispatched keyboard event moves the lamplighter and works the menus exactly
//   as a player's key does", which is what lets the mismatch be dispatched at
//   all, since Chromium derives `key` from `code` on its own.
//
// THE DRIVE. An isolated night at the origin. A `KeyboardEvent` built by the
// harness — `code` `KeyW`, `key` `z`, the character a different layout puts on
// that physical key — goes down where a typed key lands, one frame runs, and
// the matching `keyup` follows. A build reading `key` sees `z`, bound to
// nothing, and moves nothing; one reading `code` moves the lamplighter one tick
// up.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` units the harness allows a position
// integrated over ticks; one step of an exact `3` is well inside it, and the
// nearest wrong reading, no movement, is `3` units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  tapDispatched,
  type Harness,
} from "../harness";

/** The physical key: the second binding of `up`. */
const CODE = "KeyW";

/** A character that key carries on some other layout, bound to nothing here. */
const OTHER_KEY = "z";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter up for a keydown of code KeyW and key z", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.player.y, 0, "player.y before the press");

  const after = await tapDispatched(h, CODE, { key: OTHER_KEY });
  await captureStill(h, "code");

  assertNear(
    after.run.player.y,
    -MOVE_STEP,
    POSITION_TOL,
    "player.y after one frame of a keydown whose code is KeyW and key is z",
  );
});

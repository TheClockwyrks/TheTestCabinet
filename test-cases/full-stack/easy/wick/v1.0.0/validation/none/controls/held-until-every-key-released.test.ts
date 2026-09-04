// controls/held-until-every-key-released — an action stays held while any of
// its keys is down.
//
// WHAT THIS DECIDES. One thing: an action's held value is `1` while ANY of its
// keys is down, so releasing one of two keys bound to `up` leaves the
// lamplighter moving up, and it stops only when the other is released as well.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): each action is reported "as a
//   held value, `1` while any of its keys is down and `0` otherwise".
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` | held
//   on `playing`, edge elsewhere | moves the lamplighter up".
//   specs/world.md ("Movement"): `up` is `(0, -1)`, "each tick the position
//   advances by the velocity times `TICK_DT`", `MOVE_STEP` `3` a tick.
//
// THE DRIVE. An isolated night at the origin, filmed as a replay. Both keys go
// down and ten frames run; `KeyW` comes up and ten more run, over which a
// conformant build keeps moving at `MOVE_STEP` a tick while a build that
// dropped the action on the first release stands still; then `ArrowUp` comes
// up and ten more run, over which nothing moves. The first span is the
// precondition that both keys reached the build; the second and third are the
// two halves of the reading.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` units the harness allows a position
// integrated over ticks; ten steps of an exact `3` land on `30` to floating-
// point noise, and the nearest wrong reading on each span is `30` units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { BINDINGS, MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The two keys bound to `up`. */
const [FIRST_KEY, SECOND_KEY] = BINDINGS.up as readonly [string, string];

/** Frames run under each combination of keys. */
const SPAN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Hold both keys, release them one at a time, and read what each span left. */
async function releaseOneThenTheOther(): Promise<{
  both: WickSnapshot;
  one: WickSnapshot;
  none: WickSnapshot;
}> {
  await h.hold(FIRST_KEY);
  try {
    await h.hold(SECOND_KEY);
    let both: WickSnapshot;
    try {
      both = await h.step(SPAN);
    } finally {
      await h.release(SECOND_KEY);
    }
    const one = await h.step(SPAN);
    await h.release(FIRST_KEY);
    const none = await h.step(SPAN);
    return { both, one, none };
  } finally {
    await h.release(FIRST_KEY);
  }
}

it("keeps moving up under ArrowUp once KeyW is released, and stops once both are", async () => {
  await isolate(h);

  const { both, one, none } = await captureReplay(h, "held", () =>
    releaseOneThenTheOther(),
  );

  assertNear(
    both.run.player.y,
    -MOVE_STEP * SPAN,
    POSITION_TOL,
    "player.y after 10 frames with ArrowUp and KeyW both held",
  );
  assertNear(
    one.run.player.y - both.run.player.y,
    -MOVE_STEP * SPAN,
    POSITION_TOL,
    "the move over 10 frames with KeyW released and ArrowUp still held",
  );
  assertNear(
    none.run.player.y - one.run.player.y,
    0,
    POSITION_TOL,
    "the move over 10 frames with both keys released",
  );
});

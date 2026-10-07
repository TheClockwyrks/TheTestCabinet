// lamplighter/key-w-moves-like-arrow-up — a held KeyW moves the lamplighter
// exactly as a held ArrowUp does.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings")
// binds `up` to "`ArrowUp`, `KeyW`" and fixes the second key's meaning:
// "The two keys bound to an action are interchangeable: `KeyW` does exactly
// what `ArrowUp` does wherever `up` is read." On `playing` the action is read
// as a held value, and specs/world.md ("Movement") turns it into the unit
// vector of `up` times `moveSpeed` on every tick. So over the same hold
// the two keys move the lamplighter by the same displacement, and this point
// decides the second key against the first, in one direction: KeyW moves the
// lamplighter up at all, and by exactly what ArrowUp moved it.
//
// THE NIGHT. Two isolated runs (`isolate`), one per key, each the lamplighter
// alone at the origin with every driver switch off and nothing held, so the two
// holds start from the same state and nothing else moves in either. The keys
// are real key events through Chromium's input pipeline.
//
// WHAT IS READ. The displacement over `HOLD_TICKS` frames of each hold. KeyW's
// displacement along y is non-zero in the up direction, and it
// matches ArrowUp's on both axes within `POSITION_TOL`, the case's allowance
// for a position integrated over ticks. The rate itself is `move-speed`'s point;
// what is decided here is that the second key is the first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  displacement,
  holdKeysWatching,
  isolate,
  type Harness,
} from "../harness";

/** Half a second of each hold. */
const HOLD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter up by exactly what ArrowUp does while KeyW is held", async () => {
  const arrowOpened = await isolate(h);
  const arrowTicks = await holdKeysWatching(h, ["ArrowUp"], HOLD_TICKS);
  assertEqual(arrowTicks.length, HOLD_TICKS, "the frames the ArrowUp hold ran");
  const byArrow = displacement(arrowOpened, arrowTicks[HOLD_TICKS - 1]!);

  const opened = await isolate(h);
  const ticks = await captureReplay(h, "w", () =>
    holdKeysWatching(h, ["KeyW"], HOLD_TICKS),
  );
  assertEqual(ticks.length, HOLD_TICKS, "the frames the KeyW hold ran");
  const last = ticks[HOLD_TICKS - 1]!;
  assertEqual(last.screen, "playing", "the screen the KeyW hold ended on");
  const byKey = displacement(opened, last);

  assertLessThan(
    byKey.y,
    0,
    `the lamplighter's movement along y over ${HOLD_TICKS} ticks of KeyW`,
  );
  assertNear(
    byKey.y,
    byArrow.y,
    POSITION_TOL,
    `the lamplighter's movement along y over ${HOLD_TICKS} ticks of KeyW, against ArrowUp's`,
  );
  assertNear(
    byKey.x,
    byArrow.x,
    POSITION_TOL,
    `the lamplighter's movement along x over ${HOLD_TICKS} ticks of KeyW, against ArrowUp's`,
  );
});

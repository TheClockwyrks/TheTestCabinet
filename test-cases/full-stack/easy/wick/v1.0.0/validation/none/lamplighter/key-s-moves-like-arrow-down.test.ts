// lamplighter/key-s-moves-like-arrow-down — a held KeyS moves the lamplighter
// exactly as a held ArrowDown does.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings")
// binds `down` to "`ArrowDown`, `KeyS`" and fixes the second key's meaning:
// "The two keys bound to an action are interchangeable: `KeyW` does exactly
// what `ArrowUp` does wherever `up` is read." On `playing` the action is read
// as a held value, and specs/world.md ("Movement") turns it into the unit
// vector of `down` times `moveSpeed` on every tick. So over the same hold
// the two keys move the lamplighter by the same displacement, and this point
// decides the second key against the first, in one direction: KeyS moves the
// lamplighter down at all, and by exactly what ArrowDown moved it.
//
// THE NIGHT. Two isolated runs (`isolate`), one per key, each the lamplighter
// alone at the origin with every driver switch off and nothing held, so the two
// holds start from the same state and nothing else moves in either. The keys
// are real key events through Chromium's input pipeline.
//
// WHAT IS READ. The displacement over `HOLD_TICKS` frames of each hold. KeyS's
// displacement along y is non-zero in the down direction, and it
// matches ArrowDown's on both axes within `POSITION_TOL`, the case's allowance
// for a position integrated over ticks. The rate itself is `move-speed`'s point;
// what is decided here is that the second key is the first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
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

it("moves the lamplighter down by exactly what ArrowDown does while KeyS is held", async () => {
  const arrowOpened = await isolate(h);
  const arrowTicks = await holdKeysWatching(h, ["ArrowDown"], HOLD_TICKS);
  assertEqual(
    arrowTicks.length,
    HOLD_TICKS,
    "the frames the ArrowDown hold ran",
  );
  const byArrow = displacement(arrowOpened, arrowTicks[HOLD_TICKS - 1]!);

  const opened = await isolate(h);
  const ticks = await captureReplay(h, "s", () =>
    holdKeysWatching(h, ["KeyS"], HOLD_TICKS),
  );
  assertEqual(ticks.length, HOLD_TICKS, "the frames the KeyS hold ran");
  const last = ticks[HOLD_TICKS - 1]!;
  assertEqual(last.screen, "playing", "the screen the KeyS hold ended on");
  const byKey = displacement(opened, last);

  assertGreaterThan(
    byKey.y,
    0,
    `the lamplighter's movement along y over ${HOLD_TICKS} ticks of KeyS`,
  );
  assertNear(
    byKey.y,
    byArrow.y,
    POSITION_TOL,
    `the lamplighter's movement along y over ${HOLD_TICKS} ticks of KeyS, against ArrowDown's`,
  );
  assertNear(
    byKey.x,
    byArrow.x,
    POSITION_TOL,
    `the lamplighter's movement along x over ${HOLD_TICKS} ticks of KeyS, against ArrowDown's`,
  );
});

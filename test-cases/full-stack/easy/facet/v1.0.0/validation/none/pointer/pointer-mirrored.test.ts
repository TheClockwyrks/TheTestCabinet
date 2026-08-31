// Facet — pointer/pointer-mirrored: the snapshot's `pointer` reports where the
// pointer input last said it was, in the stage's logical units, and whether it is
// pressed right now.
//
// specs/instrumentation.md lists it among the three fields "the game to keep
// honest every frame": "`pointer` mirrors the position the pointer input reports
// and whether the pointer is currently pressed, refreshed in every update."
// specs/controls.md says what that input is made of — "a pointer position in the
// game's logical units on the `STAGE_W x STAGE_H` (`1280 x 720`) stage, a press
// edge, and a release edge" — so the mirror is in logical units and never in the
// pixels of whatever surface the game was laid out on.
//
// A REAL POINTER, NOT A POSED ONE. Every other point in this directory poses its
// press through the debug surface, because those points are about the press
// RULES and specs/instrumentation.md resolves a posed call at the call. This one
// is about the MIRROR, and the thing being mirrored is the pointer input itself
// refreshed by an update — so the pointer verbs deliver the event a player's
// pointer delivers, and each reading is taken after the frame that read it.
//
// THREE READINGS AND A CONTROL, one per clause of the sentence. Before anything
// is pressed the pointer is up, so `down` is a field with two values rather than
// a constant. The press reports its position with `down` true. The move follows
// it, still pressed — a build that mirrored only the press edge stops here. The
// release drops `down` to false and leaves the position where the pointer last
// reported it, because a release is an edge and not a movement.
//
// THE TWO POINTS ARE OFF THE BOARD. Both lie farther than `GEM_HIT_R` from every
// one of the 64 cell centers, proved rather than argued, so the press targets no
// cell and the mirror is read with no selection, no swap and no refusal moving
// underneath it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { GEM_HIT_R, STAGE_H, STAGE_W } from "../constants";
import {
  distanceToNearestCell,
  offBoardPoint,
  quietRowsWithEscape,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/** Where the press is made, and where the drag then carries the pointer. */
const PRESS_AT = offBoardPoint();
const MOVE_TO = { x: STAGE_W - 80, y: STAGE_H - 40 };

/**
 * How closely a mirrored coordinate is read: within half a logical unit.
 *
 * Not exactly, because a real pointer event carries its position through the
 * surface's own client coordinates before the game maps it back onto the stage,
 * and a build is entitled to lose a fraction of a unit there. Half a unit is far
 * inside anything a wrong mirror would do.
 */
const MIRROR_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports where the pointer is and whether it is pressed", async () => {
  for (const point of [PRESS_AT, MOVE_TO]) {
    assertGreaterThan(
      distanceToNearestCell(point.x, point.y),
      GEM_HIT_R,
      `(${point.x},${point.y}) lies farther than GEM_HIT_R from every cell ` +
        `center, so the pointer moving over it targets nothing`,
    );
  }

  await loadBoard(h, quietRowsWithEscape([]));

  const seen = await captureReplay(h, "pointer", async () => {
    // The control: nothing has been pressed, so `down` is false here and the
    // three readings below are not all reading a field stuck at one value.
    await h.advance(1);
    const resting = await h.snapshot();

    await h.press(PRESS_AT.x, PRESS_AT.y);
    await h.advance(1);
    const pressed = await h.snapshot();

    await h.moveTo(MOVE_TO.x, MOVE_TO.y);
    await h.advance(1);
    const moved = await h.snapshot();

    await h.lift();
    await h.advance(1);
    const lifted = await h.snapshot();

    return { resting, pressed, moved, lifted };
  });

  assertEqual(
    seen.resting.pointer.down,
    false,
    "the pointer before anything has pressed it",
  );

  assertCloseTo(
    seen.pressed.pointer.x,
    PRESS_AT.x,
    MIRROR_DIGITS,
    "the x the press reported",
  );
  assertCloseTo(
    seen.pressed.pointer.y,
    PRESS_AT.y,
    MIRROR_DIGITS,
    "the y the press reported",
  );
  assertEqual(seen.pressed.pointer.down, true, "the pointer while pressed");

  assertCloseTo(
    seen.moved.pointer.x,
    MOVE_TO.x,
    MIRROR_DIGITS,
    "the x the move reported",
  );
  assertCloseTo(
    seen.moved.pointer.y,
    MOVE_TO.y,
    MIRROR_DIGITS,
    "the y the move reported",
  );
  assertEqual(
    seen.moved.pointer.down,
    true,
    "the pointer, still pressed, after it moved",
  );

  assertEqual(seen.lifted.pointer.down, false, "the pointer after the release");
  assertCloseTo(
    seen.lifted.pointer.x,
    MOVE_TO.x,
    MIRROR_DIGITS,
    "the x the pointer input last reported, which a release does not move",
  );
  assertCloseTo(
    seen.lifted.pointer.y,
    MOVE_TO.y,
    MIRROR_DIGITS,
    "the y the pointer input last reported, which a release does not move",
  );
});

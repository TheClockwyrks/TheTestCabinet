// instrumentation/reset-pointer-position — a reset returns the pointer position
// to the origin.
//
// `specs/instrumentation.md` § The run and the screens states the pointer field
// by field, and this is the first two rows of that table: "`x` | `0` | Every
// update reads the pointer's current position into it (`specs/controls.md`), so a
// `reset` shows in it only until the next update", and "`y` | `0` | The same, on
// the other axis."
//
// SO THE READING IS TAKEN BEFORE THE NEXT UPDATE. That clause is the whole shape
// of the check: the reset writes `0`, and the very next frame reads the live
// pointer back into the fields, so a check that advanced a frame first would be
// reading what the pointer is at rather than what the reset left. Nothing is
// advanced between the `reset` and the `snapshot`.
//
// The pointer is moved somewhere neither coordinate is `0` first, and a frame is
// run so the fields are known to carry it: a build reads its input at the top of
// a frame, and a position read back as `(0, 0)` from a pointer that had never
// moved would decide nothing. The check stands on the build screen with a cleared
// world, where the pointer is what the player works the yard with, and there is
// nothing under it to pick.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A stage position with neither coordinate at the origin. */
const AT = { x: 200, y: 140 };

/** Half a logical pixel: a build may keep the position at whole pixels. */
const READ_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the pointer position to the origin", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.pointerMove(AT.x, AT.y);
  await h.advance(1);
  const moved = (await h.snapshot()).pointer;
  assertClose(moved.x, AT.x, READ_TOLERANCE, "the pointer x an update read");
  assertClose(moved.y, AT.y, READ_TOLERANCE, "the pointer y an update read");

  await h.debug.reset();
  const pointer = (await h.snapshot()).pointer;
  await h.capture("pointer", "The pointer position a reset leaves");

  assertEqual(
    pointer.x,
    0,
    "pointer.x on a reset, read before the next update (specs/instrumentation.md)",
  );
  assertEqual(
    pointer.y,
    0,
    "pointer.y on a reset, read before the next update (specs/instrumentation.md)",
  );
});

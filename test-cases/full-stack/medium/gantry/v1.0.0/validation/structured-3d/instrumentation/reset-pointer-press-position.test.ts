// instrumentation/reset-pointer-press-position — a reset returns the press
// position to the origin.
//
// `specs/instrumentation.md` § The run and the screens states the pointer field
// by field, and this is the `pressX` and `pressY` rows: "`pressX` | `0` | A press
// writes the position it went down at, and a release leaves it, so it rests where
// the last press began", and "`pressY` | `0` | The same, on the other axis."
//
// SO THE PRESS IS MADE AND RELEASED BEFORE THE RESET. "A release leaves it" is
// what makes the two fields carry something the reset has to clear: after the
// release they still rest where the press began, which the check reads back
// before resetting, so an origin read afterwards is one the reset wrote rather
// than one nothing had ever disturbed. No update rewrites either field — only a
// press does — so the reading after the reset needs no particular moment.
//
// The press goes down somewhere neither coordinate is `0`, and a frame runs
// inside it so a build that reads its input at the top of a frame has seen it.
// The check stands on the build screen with a cleared world, where the pointer is
// what the player works the yard with, and there is nothing under it to pick.

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

it("returns the press position to the origin", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.pointerDown(AT.x, AT.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);
  const released = (await h.snapshot()).pointer;
  assertClose(
    released.pressX,
    AT.x,
    READ_TOLERANCE,
    "where the press began, which the release leaves standing",
  );
  assertClose(
    released.pressY,
    AT.y,
    READ_TOLERANCE,
    "where the press began, which the release leaves standing",
  );

  await h.debug.reset();
  const pointer = (await h.snapshot()).pointer;
  await h.capture("press", "The press position a reset leaves");

  assertEqual(
    pointer.pressX,
    0,
    "pointer.pressX on a reset (specs/instrumentation.md)",
  );
  assertEqual(
    pointer.pressY,
    0,
    "pointer.pressY on a reset (specs/instrumentation.md)",
  );
});

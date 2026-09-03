// instrumentation/reset-pointer-down — a reset clears the live press, and it
// stays clear until the next press.
//
// `specs/instrumentation.md` § The run and the screens states the pointer field
// by field, and this is the `down` row: "`down` | `false` | A press sets it
// `true` and a release sets it `false`, and no update rewrites it in between: it
// is the game's own record of the press it is following rather than a reading of
// the button taken afresh. After a `reset` it is `false` until the next press."
//
// THE PRESS IS NEVER RELEASED, which is what makes the second half of that row
// checkable at all. The button is still held when the reset runs, so a build that
// refreshed `down` from the button on every update would set it back to `true` on
// the very next frame while a build that keeps its own record leaves it `false`.
// The check therefore reads the field twice — once at the reset, once after a
// frame has run — and both readings are the same requirement stated over the span
// the specification states it over.
//
// The press goes down somewhere on the stage and a frame runs inside it, so a
// build that reads its input at the top of a frame has seen the press and `down`
// is known to be `true` before the reset. The check stands on the build screen
// with an emptied yard, where the pointer is what the player works the yard with,
// and there is nothing under it to pick.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Somewhere on the stage; nothing about this position is special. */
const AT = { x: 200, y: 140 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the live press and leaves it clear while the button is still held", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.pointerDown(AT.x, AT.y);
  await h.advance(1);
  assertTrue(
    (await h.snapshot()).pointer.down,
    "the press pointerDown started, live before the reset",
  );

  await h.debug.reset();
  const atReset = (await h.snapshot()).pointer.down;
  await h.advance(1);
  const afterFrame = (await h.snapshot()).pointer.down;
  await h.capture("pointer", "The live press a reset clears");

  assertTrue(!atReset, "pointer.down on a reset (specs/instrumentation.md)");
  assertTrue(
    !afterFrame,
    "pointer.down after the next update, the button still held: no update " +
      "rewrites it, so it is false until the next press " +
      "(specs/instrumentation.md)",
  );
});

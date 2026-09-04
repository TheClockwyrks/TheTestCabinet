// instrumentation/snapshot-pointer-mirrors — `pointer` is what the pointer input
// last reported, in the stage's own units.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape: "Three fields need the
// game to keep them honest every frame: `pointer` mirrors the position and press
// the pointer input reports", declared as
// "pointer: { x: <number>, y: <number>, down: <boolean> }". `specs/controls.md`
// fixes the units and the three things the game reads: "a pointer position in the
// game's logical units on the `STAGE_W x STAGE_H` (`1280 x 720`) stage, a press
// edge, and a release edge", and "`state.pointer` mirrors the pointer's position
// and press state every frame".
//
// WHAT DRIVES IT HERE. The surface's own three operations, which
// `specs/instrumentation.md` says are that same input: "`pointerDown(x, y)`,
// `pointerMove(x, y)`, `pointerUp()` — Report a press, a move, and a release at a
// logical stage position, feeding the same input path the player's pointer feeds",
// each taking effect "immediately, when it is called, rather than being sampled
// once per frame".
//
// THE CONFIGURATION. A reset session on the title screen, where the pointer
// operates nothing — "The pointer operates the editor alone" (`specs/controls.md`)
// — so what is read back is the mirror and never the consequence of a press. Four
// positions are reported, one press and one release among them, and each is read
// both at the call and again after a frame has run, because the field is one the
// game must "keep honest every frame".
//
// THE VERDICT. Every reading is the position last reported, in stage units, with
// `down` true from the press until the release and false on either side of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("follows the position and the press the pointer input reports", async () => {
  await openTitle(h);

  await h.debug.pointerMove(320, 180);
  const moved = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "pointer");
  assertEqual(moved.pointer.x, 320, "pointer.x is the position last reported");
  assertEqual(moved.pointer.y, 180, "pointer.y is the position last reported");
  assertEqual(moved.pointer.down, false, "nothing has been pressed yet");

  const held = await h.snapshot();
  assertEqual(held.pointer.x, 320, "a frame keeps the mirrored position");
  assertEqual(held.pointer.y, 180, "a frame keeps the mirrored position");
  assertEqual(
    held.pointer.down,
    false,
    "a frame keeps the mirrored press state",
  );

  await h.debug.pointerMove(1100, 640);
  const again = await h.snapshot();
  assertEqual(again.pointer.x, 1100, "pointer follows a second move");
  assertEqual(again.pointer.y, 640, "pointer follows a second move");

  await h.debug.pointerDown(720, 400);
  const pressed = await h.snapshot();
  assertEqual(pressed.pointer.x, 720, "a press reports its own position");
  assertEqual(pressed.pointer.y, 400, "a press reports its own position");
  assertEqual(
    pressed.pointer.down,
    true,
    "pointer.down goes down with pointerDown",
  );

  await h.advance(1);
  const stillDown = await h.snapshot();
  assertEqual(stillDown.pointer.down, true, "the press stands across a frame");

  await h.debug.pointerMove(760, 420);
  const dragged = await h.snapshot();
  assertEqual(dragged.pointer.x, 760, "pointer follows a move made while down");
  assertEqual(dragged.pointer.y, 420, "pointer follows a move made while down");
  assertEqual(dragged.pointer.down, true, "a move does not release the press");

  await h.debug.pointerUp();
  const released = await h.snapshot();
  assertEqual(
    released.pointer.down,
    false,
    "pointer.down goes up with pointerUp",
  );

  await h.advance(1);
  const after = await h.snapshot();
  assertEqual(after.pointer.down, false, "the release stands across a frame");
});

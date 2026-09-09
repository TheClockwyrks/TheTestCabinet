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
// WHAT DRIVES IT HERE. The pointer input itself: the harness's real pointer, one
// frame per sample, which is the input the field is said to mirror. The surface's
// own `pointerDown`, `pointerMove` and `pointerUp` take effect at the call and
// are what the editor's points drive; what a FRAME leaves in `pointer` is fixed
// only against the input the runtime reports, and under an engine that input
// never saw a posed press, so a mirror refreshed from it every frame, which is
// what `specs/state.md` describes, reports the input rather than the pose. A real
// press is the one reading every build must agree on.
//
// THE CONFIGURATION. A reset session on the title screen. The title's menu answers
// a pointer of its own (`specs/ui.md`, Pointer and touch), and what a press there
// may also have done is beside the point: `state.pointer` "mirrors the pointer's
// position and press state every frame" (`specs/controls.md`) whatever the press
// meant, and nothing but that mirror is read here. Four positions are reported,
// one press and one release among them, each read on the frame that delivered it
// and again after a further frame has run, because the field is one the game
// must "keep honest every frame".
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

  await h.mouseGlide(320, 180);
  const moved = await h.snapshot();
  await captureStill(h, "pointer");
  assertEqual(moved.pointer.x, 320, "pointer.x is the position last reported");
  assertEqual(moved.pointer.y, 180, "pointer.y is the position last reported");
  assertEqual(moved.pointer.down, false, "nothing has been pressed yet");

  await h.advance(1);
  const held = await h.snapshot();
  assertEqual(held.pointer.x, 320, "a frame keeps the mirrored position");
  assertEqual(held.pointer.y, 180, "a frame keeps the mirrored position");
  assertEqual(
    held.pointer.down,
    false,
    "a frame keeps the mirrored press state",
  );

  await h.mouseGlide(1100, 640);
  const again = await h.snapshot();
  assertEqual(again.pointer.x, 1100, "pointer follows a second move");
  assertEqual(again.pointer.y, 640, "pointer follows a second move");

  await h.mousePress(720, 400);
  const pressed = await h.snapshot();
  assertEqual(pressed.pointer.x, 720, "a press reports its own position");
  assertEqual(pressed.pointer.y, 400, "a press reports its own position");
  assertEqual(
    pressed.pointer.down,
    true,
    "pointer.down goes down with a press",
  );

  await h.advance(1);
  const stillDown = await h.snapshot();
  assertEqual(stillDown.pointer.down, true, "the press stands across a frame");

  await h.mouseGlide(760, 420);
  const dragged = await h.snapshot();
  assertEqual(dragged.pointer.x, 760, "pointer follows a move made while down");
  assertEqual(dragged.pointer.y, 420, "pointer follows a move made while down");
  assertEqual(dragged.pointer.down, true, "a move does not release the press");

  await h.mouseRelease();
  const released = await h.snapshot();
  assertEqual(
    released.pointer.down,
    false,
    "pointer.down goes up with the release",
  );

  await h.advance(1);
  const after = await h.snapshot();
  assertEqual(after.pointer.down, false, "the release stands across a frame");
});

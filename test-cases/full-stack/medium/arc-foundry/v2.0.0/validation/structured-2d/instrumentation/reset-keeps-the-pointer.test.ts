// instrumentation/reset-keeps-the-pointer — a reset leaves the reported pointer
// where the device is.
//
// `specs/instrumentation.md` names the pointer position among the fields a reset
// does NOT touch: it says where the device is rather than anything about the run,
// and a reset that teleported it back to the origin would be a reset reaching
// outside the run it is resetting. It matters here more than it looks: the
// pointer readings the menu and the control checks drive are taken across resets,
// and a build that clears it on one puts every one of them somewhere else.
//
// THE MUTE BIT IS THE SIBLING POINT `reset-keeps-mute`, and every field a reset
// DOES restore is `reset-title-state`.
//
// THE READING IS TAKEN WITH NO FRAME BETWEEN. The position reaches the game from
// the runtime, which under this engine still holds it after a reset, so a reading
// taken a frame later would be satisfied by a build that cleared the field and
// then read it back in. `reset` is a pose and `snapshot` is a reading, so both are
// taken with the clock standing still and what is read is the reset's own answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Somewhere the pointer plainly is not by default. */
const POINTER_AT = { x: 611, y: 397 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the reported pointer across a reset", async () => {
  // The pointer is moved at the engine's own surface, and the frame is what lets
  // the game read where it went.
  openYard(h);
  h.pointerMove(POINTER_AT.x, POINTER_AT.y);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.pointer.x, POINTER_AT.x, "the pointer x before the reset");
  assertEqual(before.pointer.y, POINTER_AT.y, "the pointer y before the reset");

  h.debug.reset();

  const after = h.snapshot();
  assertEqual(after.screen, "title", "snapshot().screen after the reset");
  assertEqual(
    after.pointer.x,
    POINTER_AT.x,
    "snapshot().pointer.x after a reset",
  );
  assertEqual(
    after.pointer.y,
    POINTER_AT.y,
    "snapshot().pointer.y after a reset",
  );

  await h.advance(1);
  captureStill(h, "title");
});

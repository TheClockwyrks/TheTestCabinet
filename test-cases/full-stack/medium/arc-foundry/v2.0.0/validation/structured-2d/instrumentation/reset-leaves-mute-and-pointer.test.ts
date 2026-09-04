// instrumentation/reset-leaves-mute-and-pointer — the two fields a reset does NOT
// touch, because neither belongs to the game.
//
// `specs/instrumentation.md` names them both: the mute bit is a player preference
// and the pointer position is where the device is, and a reset that silently
// unmuted the game or teleported the pointer back to the origin would be a reset
// reaching outside the run it is resetting.
//
// THE READING IS TAKEN WITH NO FRAME BETWEEN. Both values reach the game from the
// runtime, which under this engine still holds them after a reset, so a reading
// taken a frame later would be satisfied by a build that cleared each field and
// then read it back in. `reset` is a pose and `snapshot` is a reading, so both are
// taken with the clock standing still and what is read is the reset's own answer.
//
// The other direction — every field a reset DOES restore — is the sibling point
// `reset-title-state`. This one decides only that these two survive it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
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

it("keeps the mute bit and the pointer across a reset", async () => {
  // Mute reached through the action `specs/controls.md` binds it to, because the
  // surface carries no operation that sets the bit: it is the runtime's, and the
  // game only mirrors it. The pointer is moved at the engine's own surface, and
  // the frame is what lets the game read where it went.
  openYard(h);
  await pressAction(h, "mute");
  h.pointerMove(POINTER_AT.x, POINTER_AT.y);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.muted, true, "the mute bit before the reset");
  assertEqual(before.pointer.x, POINTER_AT.x, "the pointer x before the reset");
  assertEqual(before.pointer.y, POINTER_AT.y, "the pointer y before the reset");

  h.debug.reset();

  const after = h.snapshot();
  assertEqual(after.screen, "title", "snapshot().screen after the reset");
  assertEqual(after.muted, true, "snapshot().muted after a reset");
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

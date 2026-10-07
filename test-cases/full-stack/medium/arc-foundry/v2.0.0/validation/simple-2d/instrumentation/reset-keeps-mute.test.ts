// instrumentation/reset-keeps-mute — a reset leaves the mute bit where the player
// put it.
//
// `specs/instrumentation.md` names the mute bit among the fields a reset does NOT
// touch: it is a player preference rather than part of the run, and a reset that
// silently unmuted the game would be a reset reaching outside the run it is
// resetting.
//
// THE POINTER IS THE SIBLING POINT `reset-keeps-the-pointer`, and every field a
// reset DOES restore is `reset-title-state`. A build that carries the preference
// across a reset but teleports the pointer back to the origin has missed one
// requirement, not two, so the two survivors are decided apart.
//
// THE READING IS TAKEN WITH NO FRAME BETWEEN. The bit reaches the game from the
// runtime, which under this engine still holds it after a reset, so a reading
// taken a frame later would be satisfied by a build that cleared the field and
// then read it back in. `reset` is a pose and `snapshot` is a reading, so both are
// taken with the clock standing still and what is read is the reset's own answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the mute bit across a reset", async () => {
  // Mute reached through the action `specs/controls.md` binds it to, because the
  // surface carries no operation that sets the bit: it is the runtime's, and the
  // game only mirrors it.
  openYard(h);
  await pressAction(h, "mute");

  const before = h.snapshot();
  assertEqual(before.muted, true, "the mute bit before the reset");

  h.debug.reset();

  const after = h.snapshot();
  assertEqual(after.screen, "title", "snapshot().screen after the reset");
  assertEqual(after.muted, true, "snapshot().muted after a reset");

  await h.advance(1);
  captureStill(h, "title");
});

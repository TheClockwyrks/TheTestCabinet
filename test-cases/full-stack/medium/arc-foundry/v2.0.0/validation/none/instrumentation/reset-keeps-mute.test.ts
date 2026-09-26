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

afterEach(async () => {
  await h.dispose();
});

it("keeps the mute bit across a reset", async () => {
  // Mute reached through the action `specs/controls.md` binds it to, because the
  // surface carries no operation that sets the bit: it is the runtime's, and the
  // game only mirrors it.
  await openYard(h);
  await pressAction(h, "mute");

  const before = await h.snapshot();
  assertEqual(before.muted, true, "the mute bit before the reset");

  await h.debug.reset();
  await h.advance(1);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(after.screen, "title", "snapshot().screen after the reset");
  assertEqual(after.muted, true, "snapshot().muted after a reset");
});

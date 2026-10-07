// Meltdown — instrumentation/no-pose-for-muting — the surface carries no operation that
// sets muting.
//
// THE RULE. specs/instrumentation.md, What the runtime provides instead: "Muting
// is the other. There is no operation that sets it: `mute` is reached the way a
// player reaches it, through its binding in `specs/controls.md` or the panel's
// mute control, and the snapshot reports the result."
//
// WHY THE ABSENCE IS READ RATHER THAN ASSUMED. A build that added a `setMuted`
// would have added an operation the specification does not carry, and would then
// be able to silence its own audio through a path no player has — so `muted` would
// no longer be the runtime's bit the snapshot merely reports. The surface is
// therefore reflected for the name, and the name must not be callable.
//
// WHAT THIS DOES NOT DECIDE. What pressing the binding or the panel's control does
// is `controls.mute-key`'s and `controls.mute-control`'s, what the control looks
// like is `hud.mute-read`'s, and that a muted game emits nothing is
// `audio.mute-silences`'s. This one reads the surface alone, and drives nothing.
//
// IT IS THE ONE READING IN THIS GROUP THAT NEEDS NO RUN AT ALL, so nothing is
// posed: a surface that carried the operation would carry it on a title screen
// just as much as mid-wave.

import { beforeEach, afterEach, it } from "vitest";
import { assertUndefined } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries no operation that sets muting", async () => {
  // The evidence: the game the surface was reflected on. Nothing is posed, so
  // this is the title screen the harness's opening `reset` left behind.
  await h.advance(1);
  captureStill(h, "surface");

  const api = h.debug as unknown as Record<string, unknown>;
  assertUndefined(
    api.setMuted,
    "specs/instrumentation.md gives muting to the runtime: there is no setMuted",
  );
});

// controls/mute-toggles-on-title — KeyM flips the sound on the title.
//
// specs/controls.md binds `mute` to `KeyM` and gives it, on a menu-bearing
// screen, "Toggles sound." The same action during a round is
// `controls/mute-toggles-on-playing`, and they are two points because the file
// adds that "`mute` is read on every screen and does the same thing on each": a
// build that mutes mid-round but not from the title leaves the player unable to
// silence a game they have not started.
//
// `muted` is not a posable field. specs/instrumentation.md keeps it honest by
// mirroring the runtime's mute bit into the state every frame rather than by an
// operation, and it leaves `muted` untouched across a `reset` because muting is a
// player preference — so the flip is read as a CHANGE from whatever the screen
// was carrying rather than as an absolute value.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted when KeyM is read on the title screen", async () => {
  const title = poseScene(h, { screen: "title" });
  assertEqual(title.screen, "title", "the screen the key is pressed on");

  await h.tap(KEY.mute);
  captureStill(h, "muted");

  assertEqual(
    h.snapshot().muted,
    !title.muted,
    "the sound state after mute is read on the title screen",
  );
});

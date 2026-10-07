// controls/mute-toggles-on-playing — KeyM flips the sound during a round.
//
// specs/controls.md binds `mute` to `KeyM` and gives it, on `playing`, "Toggles
// sound." The same action on a menu-bearing screen is
// `controls/mute-toggles-on-title`, and they are two points because the file adds
// that "`mute` is read on every screen and does the same thing on each": a build
// that mutes from the title but not mid-round leaves the player unable to silence
// the game at the moment they want to.
//
// `muted` is not a posable field. specs/instrumentation.md keeps it honest by
// mirroring the runtime's mute bit into the state every frame rather than by an
// operation, and it leaves `muted` untouched across a `reset` because muting is a
// player preference — so the flip is read as a CHANGE from whatever the screen
// was carrying rather than as an absolute value.
//
// The live round is posed with the chain held still and nothing on the board, so
// nothing can end the round underneath the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted when KeyM is read on the playing screen", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  assertEqual(live.screen, "playing", "the screen the key is pressed on");

  await h.tap(KEY.mute);
  await captureStill(h, "muted");

  assertEqual(
    (await h.snapshot()).muted,
    !live.muted,
    "the sound state after mute is read on the playing screen",
  );
});

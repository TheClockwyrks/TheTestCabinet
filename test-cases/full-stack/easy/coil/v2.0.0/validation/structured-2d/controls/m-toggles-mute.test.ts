// controls/m-toggles-mute — KeyM flips the sound, on every screen.
//
// specs/controls.md binds `mute` to `KeyM` and gives it the same entry on a
// menu-bearing screen and on `playing`: "Toggles sound." The file adds that
// "`mute` is read on every screen and does the same thing on each", so both
// halves are read here rather than only one: a build that mutes from the title
// but not mid-round leaves the player unable to silence the game while playing
// it, which is the moment they want to.
//
// `muted` is not a posable field. specs/instrumentation.md keeps it honest by
// mirroring the engine's mute bit into the state every frame rather than by an
// operation, and it leaves `muted` untouched across a `reset` because muting is a
// player preference — so the flip is read as a change from whatever the screen
// before it left, and the two presses are read as two flips rather than as two
// absolute values.
//
// The live round is posed with the chain held still and nothing on the board, so
// nothing can end the round underneath the press.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds to `mute`. */
const MUTE = BINDINGS.mute[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted on the playing screen and on the title alike", async () => {
  const live = poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });

  await h.tap(MUTE);
  captureStill(h, "muted");
  const onPlaying = h.snapshot();
  assertEqual(
    onPlaying.muted,
    !live.muted,
    "the sound state after mute is read on the playing screen",
  );

  // A reset leaves `muted` alone, so the title inherits whatever the round left.
  const title = poseScene(h, { screen: "title" });
  assertEqual(title.muted, onPlaying.muted, "the sound state a reset carried");

  await h.tap(MUTE);
  assertEqual(
    h.snapshot().muted,
    !title.muted,
    "the sound state after mute is read on the title screen",
  );
});

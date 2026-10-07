// Refract — screens/mute-from-playing: one press of the mute action on the
// playing screen flips the snapshot's muted flag.
//
// specs/ui.md "Audio": the game "binds the `mute` action to the runtime's mute
// bit and toggles it from any screen, then mirrors that bit into `state.muted`
// every frame"; specs/controls.md lists `mute` among the registered actions,
// "read on every screen". A board is posed onto `playing` through `loadBoard`,
// and the press is asserted as a FLIP of whatever the flag held rather than as
// a landing on a fixed value: no spec fixes what the bit rests at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted from the playing screen", async () => {
  await loadBoard(h, R3_REDRAW);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "posing: loadBoard moves to playing",
  );

  const before = (await h.snapshot()).muted;
  await fireAction(h, "mute");
  await h.advance(1);
  await captureStill(h, "playing-muted");

  assertEqual(
    (await h.snapshot()).muted,
    !before,
    "one mute press flips muted on the playing screen",
  );
});

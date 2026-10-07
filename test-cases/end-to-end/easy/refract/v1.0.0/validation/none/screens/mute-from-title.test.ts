// Refract — screens/mute-from-title: one press of the mute action on the title
// flips the snapshot's muted flag.
//
// specs/ui.md "Audio": the game "binds the `mute` action to the runtime's mute
// bit and toggles it from any screen, then mirrors that bit into `state.muted`
// every frame"; specs/controls.md lists `mute` among the registered actions,
// "read on every screen". The press is asserted as a FLIP of whatever the flag
// held rather than as a landing on a fixed value: no spec fixes what the bit
// rests at, and `reset` is specified to leave it alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted from the title", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the game opens on the title",
  );

  const before = (await h.snapshot()).muted;
  await fireAction(h, "mute");
  await h.advance(1);
  await captureStill(h, "title-muted");

  assertEqual(
    (await h.snapshot()).muted,
    !before,
    "one mute press flips muted on the title",
  );
});

// Wick — instrumentation/set-screen-playing-keeps-switches: with `spawning`
// and `weaponFire` posed off, `setScreen('playing')` begins a fresh run with
// both still off.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen(name)`: "The driver switches stay as they are"; "The driver
// switches": "each is left as it stands by `setScreen`"; "Snapshot shape":
// "The seven switches sit beside `muted`, outside `run`, and a fresh run leaves
// them as they stand."
//
// THE POSE. `reset` (every switch on), two turned off, the pose, read at the
// call: the two off, the other five on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  disable,
  switchesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the switches as they stand across a fresh run", async () => {
  h.reset();
  disable(h, "spawning", "weaponFire");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "switches");

  assertEqual(after.screen, "playing", "screen after the pose");
  assertDeepEqual(
    switchesOf(after),
    {
      spawning: false,
      events: true,
      despawning: true,
      enemyMotion: true,
      enemyContact: true,
      weaponFire: false,
      effectMotion: true,
    },
    "the seven switches after setScreen('playing')",
  );
});

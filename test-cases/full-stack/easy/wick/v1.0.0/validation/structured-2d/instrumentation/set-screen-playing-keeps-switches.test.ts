// Wick — instrumentation/set-screen-playing-keeps-switches: with `spawning`
// and `weaponFire` posed off, `setScreen('playing')` leaves both off.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Nothing else changes: ... the driver switches all stand
// exactly as they were"; "The driver switches": "each is left as it stands by
// `setScreen`"; "Snapshot shape": "The nine switches sit beside `muted`,
// outside `run`, and a fresh run leaves them as they stand."
//
// THE POSE. `reset` (every switch on), two turned off, the pose, read at the
// call: the two off, the other seven on.

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

it("leaves the switches as they stand across the pose", async () => {
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
      drops: true,
      progression: true,
    },
    "the nine switches after setScreen('playing')",
  );
});

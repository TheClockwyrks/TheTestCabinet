// Wick — instrumentation/set-screen-playing-inert-on-levelup:
// `setScreen('playing')` on `levelup` leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `playing` from `levelup`: "Changes nothing; `choose`
// is the way out."
//
// THE POSE. An isolated run with the level-up overlay opened by the real tick
// (`openLevelUp`), then the pose. The whole snapshot before is compared with
// the whole snapshot after, structurally — nothing moves at a call, `simTime`
// and `muted` included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the overlay open with its offers", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertEqual(before.screen, "levelup", "screen before the pose");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");

  assertDeepEqual(
    after,
    before,
    "snapshot after setScreen('playing') on levelup",
  );
});

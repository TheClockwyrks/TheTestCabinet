// torpedo/the-torpedo-action-launches-one — the torpedo key puts a torpedo up.
//
// specs/controls.md binds `KeyF` to "Launch the torpedo" while the game is being
// played, and reads it "as a press alone: one launch per press, with no repeat
// while the key is held". specs/weapons.md says what that press produces: one
// torpedo, from a ship whose charge is full. This is the item that decides the
// binding answers at all, so it is the one a build that implements no torpedo
// fails — which is why every other check in this group reads its torpedo through
// a hard assertion rather than crashing on an empty roster.
//
// EXACTLY ONE, NOT AT LEAST ONE. A build that launches a salvo on one press has
// broken the same sentence as one that launches nothing, and the roster length is
// what tells the two apart. The field is emptied and both world gates are shut by
// `startPlaying`, and the charge it leaves full is the one condition
// specs/weapons.md puts on a launch, so nothing but the press can add a torpedo
// to this field.
//
// THE SHIP IS MOVED OFF THE SAFE POINT FIRST. `startPlaying` leaves it at
// `(640, 560)` facing up the field, which is 200 units straight below the star:
// a torpedo launched from there flies into the core, which absorbs it
// (specs/collision.md), so the roster could read empty a tick later for a reason
// that has nothing to do with the key. See `scene.ts` for where it stands instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseShip, pressTorpedo, torpedoRoster } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts exactly one torpedo in the roster for one press of the torpedo key", async () => {
  await startPlaying(h);
  await poseShip(h);

  const launched = await pressTorpedo(h);
  // The torpedo the press put in flight.
  await captureStill(h, "launch");

  assertLength(
    torpedoRoster(launched, "one press of the torpedo key"),
    1,
    "exactly one torpedo in flight after one press of KeyF from a charged " +
      "ship (specs/controls.md: the torpedo is read as a press alone, one " +
      "launch per press; specs/weapons.md: at most one torpedo is in flight " +
      "at a time)",
  );
});

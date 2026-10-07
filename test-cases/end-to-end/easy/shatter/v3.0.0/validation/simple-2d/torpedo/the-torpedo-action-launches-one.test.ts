// torpedo/the-torpedo-action-launches-one — the torpedo binding puts a torpedo up.
//
// `specs/controls.md` gives the `b` action the meaning "Launch the torpedo" while
// the game is being played, binds it to `KeyF` under this variant, and reads it "as
// a press alone: one launch per press, with no repeat while the key is held".
// `specs/weapons.md` says what that press produces: one torpedo, from a ship whose
// charge is full. This is the item that decides the binding answers at all, so it
// is the one a build that implements no torpedo fails — which is why every other
// check in this group reads its torpedo through a hard assertion rather than
// crashing on an empty roster.
//
// EXACTLY ONE, NOT AT LEAST ONE. A build that launches a salvo on one press has
// broken the same sentence as one that launches nothing, and the roster length is
// what tells the two apart. The field is emptied and both world gates are shut by
// `startPlaying`, and the charge it leaves full is the one condition
// `specs/weapons.md` puts on a launch, so nothing but the press can add a torpedo
// to this field.
//
// THE SHIP IS MOVED OFF THE SAFE POINT FIRST. `startPlaying` leaves it at
// `(640, 560)` facing `FACE_UP`, which is `200` units straight below the star: a
// torpedo launched from there flies into the core, which absorbs it
// (`specs/collision.md`), so the roster could read empty two ticks later for a
// reason that has nothing to do with the binding. See `scene.ts` for where it
// stands instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import { poseShip, pressTorpedo } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly one torpedo in the roster for one press of the torpedo binding", async () => {
  startPlaying(h);
  poseShip(h);

  const launched = await pressTorpedo(h);
  // The torpedo the press put in flight.
  captureStill(h, "launch");

  assertLength(
    torpedoesOf(launched),
    1,
    "exactly one torpedo in flight after one press of the torpedo binding " +
      "from a charged ship (specs/controls.md: the torpedo is read as a press " +
      "alone, one launch per press; specs/weapons.md: at most one torpedo is " +
      "in flight at a time)",
  );
});

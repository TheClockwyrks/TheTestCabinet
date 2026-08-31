// torpedo/the-torpedo-action-launches-one — one press of the torpedo key puts
// exactly one torpedo in flight.
//
// THE RULE. `specs/controls.md` binds the `b` action to `KeyF` under `warhead`
// and gives it one meaning while playing — "Launch the torpedo" — and reads it
// "as a press alone: one launch per press, with no repeat while the key is held".
// `specs/weapons.md` states what that press produces: a torpedo leaving the
// ship's nose, and at most one in flight at a time. This item decides that the
// binding launches AT ALL, and that one press is worth exactly one torpedo.
//
// IT IS THE ITEM EVERY OTHER LAUNCH ITEM LEANS ON, which is why its cap is
// `broken`: a build whose torpedo key does nothing has no torpedo, and this is
// the one item that says so in as many words. Every check in this group that goes
// on to read a torpedo hard-asserts it first (`requireOnlyTorpedo`, `poseTorpedo`),
// so such a build fails HERE rather than crashing the suite and being misreported
// as one that never exposed a debug surface.
//
// EXACTLY ONE, IN BOTH DIRECTIONS. The roster is read before the press as well as
// after it, so "one torpedo in flight" is one the press produced rather than one
// that was already up. A build that launches nothing reads `0`; a build that
// launches on both the press and the release, or once per bound key, reads `2`.
// Both are a different number from the one the specification fixes.
//
// THE GROUND IS AN EMPTY, QUIET FIELD with the charge full, which is what
// `startPlaying` leaves: `specs/weapons.md` refuses a launch while the charge is
// below `1` or while a torpedo is already up, and neither refusal is this item's
// subject — `torpedo/no-launch-while-recharging` and `torpedo/at-most-one-in-flight`
// are those. So the press this check makes is one the specification obliges the
// build to answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  torpedoesOf,
  type Harness,
} from "../harness";
import { TORPEDO_ACTION } from "./scenario";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly one torpedo in flight for one press of the torpedo key", async () => {
  startPlaying(h);

  assertLength(
    torpedoesOf(h.snapshot()),
    0,
    "no torpedo in flight before the key is pressed, so the one read after " +
      "it is the one the press produced (specs/weapons.md)",
  );

  await tapAction(h, TORPEDO_ACTION);
  const after = h.snapshot();
  // The torpedo the action put in flight.
  captureStill(h, "launch");

  assertLength(
    torpedoesOf(after),
    1,
    "exactly one torpedo in flight one tick after a single press of the " +
      "torpedo key on a charged ship — the key launches the torpedo " +
      "(specs/controls.md) and one press is one launch (specs/weapons.md)",
  );
});

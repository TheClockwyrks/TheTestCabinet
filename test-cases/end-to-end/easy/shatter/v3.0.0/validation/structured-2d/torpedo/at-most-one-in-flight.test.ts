// torpedo/at-most-one-in-flight — the key launches nothing while one is up.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "At most one torpedo
// is in flight at a time. While one is up, the key launches nothing WHATEVER THE
// CHARGE READS."
//
// THE CHARGE IS POSED FULL, and that is what makes this a different item from
// `torpedo/no-launch-while-recharging`. With the charge spent, the recharge rule
// alone accounts for the refusal and no build could fail the two items
// differently; with it full, the ONLY rule that can refuse the press is the one
// under test. So a build that implements the recharge gate and forgets the
// one-at-a-time gate loses exactly this point, and a build that forgets both
// loses two.
//
// THE STANDING TORPEDO IS POSED RATHER THAN FIRED. `addTorpedo` puts one in
// flight directly (`specs/instrumentation.md`), so this scenario does not depend
// on the launch working — that is
// `torpedo/the-torpedo-action-launches-one`'s item — and the roster it reads
// afterwards holds a torpedo this check knows the id of.
//
// WHERE IT STANDS. The far quiet corner, `(960, 100)`, `412` units from the star
// and half a field from the ship at the safe point, travelling along `+x` away
// from the star's column. Over the single tick this check runs it moves three and
// a half units and meets nothing: `startPlaying` leaves no rock, no round and no
// saucer on the field, so the torpedo that is up at the reading is the torpedo
// that was up before the press.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no gate at all
// reads two torpedoes. A build that replaces the one in flight rather than
// refusing reads one — with a DIFFERENT id, which the second assertion catches,
// because a torpedo swapped for a fresh one is not the torpedo the specification
// left in flight.
//
// AND THE PRESS THE RULE NO LONGER REFUSES IS THE CONTROL. A refusal is only
// evidence of a gate if the same press, made with nothing to refuse it, launches.
// Without that reading a build that ignores the torpedo key altogether — or never
// binds it, or has no torpedo at all — reads "exactly one torpedo in flight"
// after the press and passes, because the one it was posed with is still there.
// So the standing torpedo is removed, the charge is posed full again, and the
// SAME action is driven a second time: one torpedo must be in flight after it.
// That is what makes the first reading a reading of the one-at-a-time rule rather
// than of a key the build never listened to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { QUIET_CORNER_OPPOSITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import {
  POSED_CHARGE_SLACK,
  TORPEDO_ACTION,
  poseTorpedo,
  requireCharge,
} from "./scenario";

/** Where the standing torpedo is posed, and the heading it holds. */
const STANDING = QUIET_CORNER_OPPOSITE;
/** Along `+x`, away from the star's column and clear of everything. */
const STANDING_HEADING = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no second torpedo when the key is pressed with one already in flight", async () => {
  startPlaying(h);
  const standing = poseTorpedo(h, STANDING.x, STANDING.y, STANDING_HEADING);
  h.debug.setTorpedoCharge?.(1);

  const posed = h.snapshot();
  assertLessThanOrEqual(
    Math.abs(
      requireCharge(posed, "the charge the refused press is made on") - 1,
    ),
    POSED_CHARGE_SLACK,
    "the charge posed full, so nothing but the one-at-a-time rule can refuse " +
      "the press (specs/weapons.md, specs/instrumentation.md)",
  );
  assertLength(
    torpedoesOf(posed),
    1,
    "exactly one torpedo in flight before the press, which is the state the " +
      "specification refuses a launch in (specs/instrumentation.md)",
  );

  await tapAction(h, TORPEDO_ACTION);
  const after = h.snapshot();
  // The one torpedo up, with the launch refused.
  captureStill(h, "refused");

  const up = torpedoesOf(after);
  assertLength(
    up,
    1,
    "still exactly one torpedo in flight after the torpedo key was pressed " +
      "with the charge full — at most one torpedo is in flight at a time, and " +
      "while one is up the key launches nothing whatever the charge reads " +
      "(specs/weapons.md)",
  );
  assertEqual(
    up[0].id,
    standing,
    "the torpedo still in flight to be the one that was already up, rather " +
      "than a fresh one launched in its place — the press launches nothing " +
      "(specs/weapons.md)",
  );

  // The control: the same action, on the same ship, with the field clear of
  // torpedoes and the charge posed full again.
  requireOp(h.debug, "removeTorpedo")(standing);
  h.debug.setTorpedoCharge?.(1);
  assertLength(
    torpedoesOf(h.snapshot()),
    0,
    "the field clear of torpedoes for the control press, which is what leaves " +
      "the one-at-a-time rule nothing to refuse (specs/instrumentation.md)",
  );

  await tapAction(h, TORPEDO_ACTION);
  assertLength(
    torpedoesOf(h.snapshot()),
    1,
    "exactly one torpedo in flight after the SAME press was made with the " +
      "field clear and the charge full — the control that says this build " +
      "answers to the torpedo key at all, and so that the torpedo already up " +
      "is what refused the press before it (specs/weapons.md, " +
      "specs/controls.md: one launch per press)",
  );
});

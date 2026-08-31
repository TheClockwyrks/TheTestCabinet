// rocks/fragment-kick-is-perpendicular-to-the-shot — the fan lies across the SHOT.
//
// `specs/collision.md`, The fragment fan, says which line the fan opens across and
// then says it again so it cannot be mistaken: the kick is "perpendicular to the
// bullet's travel at the moment it landed", and "The perpendicular is taken from
// the bullet's own direction of travel, not from the rock's course, so the fan lies
// across the shot whatever the rock was doing."
//
// THE POSE EXISTS TO SEPARATE THE TWO CONVENTIONS, AND IT IS FOLD-IN FIX C. The
// parent stands at `(320, 620)` drifting `(-60, -60)` and is shot along the field's
// `x` axis, so the perpendicular of the shot is vertical and the perpendicular of
// the rock's course is `45` degrees from it. A build that kicks across the ROCK's
// course therefore throws its pair `127` units per second along the shot, against a
// bound of `30`; a build that kicks across the SHOT throws it none. Posed on a line
// the rock happened to be drifting along, the two conventions agree and the wrong
// build passes — which is exactly what the previous version of this case did.
//
// READ OFF THE PAIR. `specs/collision.md` gives each fragment the parent's velocity
// plus a kick, the two kicked to opposite sides, so the DIFFERENCE between the two
// velocities is twice the kick with the parent's whole motion — and everything the
// well added to it — cancelled exactly. What is asserted is that difference's
// component ALONG the shot, which is `0` for a fan that lies across it.
//
// AND THE SHOT IS THE BUILD'S OWN, not this file's idea of it: the bullet's
// velocity is read back off the tick before it landed, so what the fan is measured
// against is the travel the build actually gave the round.
//
// THE BOUND IS THE REVIEW ITEM'S FIGURE, `30` units per second, on a difference
// whose magnitude the specification fixes at `2 x SPLIT_KICK` (`180`) — so it
// admits a fan up to `9.6` degrees off perpendicular, room for a build's own
// arithmetic and for the quarter of a unit per second the well adds over the tick,
// and nothing near the `45` degrees the wrong convention costs.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { componentAlong, subtract } from "../geometry";
import {
  captureReplay,
  createHarness,
  requireBullet,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";
import {
  FAN_DRIFT,
  QUIET_GROUND,
  fragmentPair,
  killHorizontally,
  poseRockAt,
} from "./scene";

/** How much of the fan may lie along the shot, in units per second: the item's figure. */
const ALONG_TOLERANCE = 30;

/** Seconds of the fan opening, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the fan across the bullet's travel rather than across the rock's course", async () => {
  await startPlaying(h);
  const parentId = await poseRockAt(h, "large", QUIET_GROUND, FAN_DRIFT);

  const kill = await captureReplay(h, "fan", async () => {
    const shot = await killHorizontally(h, parentId);
    await h.advance(AFTERMATH_TICKS);
    return shot;
  });

  const round = requireBullet(
    kill.before,
    kill.bullet,
    "the round in flight on the tick before it landed",
  );
  const [a, b] = fragmentPair(
    kill.at,
    "medium",
    "fragment-kick-is-perpendicular-to-the-shot",
  );
  const fan = subtract(velocityOf(a), velocityOf(b));

  assertLessThanOrEqual(
    Math.abs(componentAlong(fan, velocityOf(round))),
    ALONG_TOLERANCE,
    "units per second of the fan lying ALONG the bullet's travel rather than across it (specs/collision.md)",
  );
});

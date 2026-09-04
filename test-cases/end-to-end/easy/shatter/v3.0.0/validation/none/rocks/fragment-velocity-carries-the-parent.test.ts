// rocks/fragment-velocity-carries-the-parent — the pieces leave on the parent's course.
//
// `specs/collision.md`, The fragment fan: "Each fragment's velocity is the
// destroyed rock's velocity on the tick it was destroyed, plus a kick of
// `SPLIT_KICK` (`90`) perpendicular to the bullet's travel at the moment it landed,
// the two fragments kicked to opposite sides." This item decides the FIRST term of
// that sum and nothing else: the two kicks are equal and opposite, so their AVERAGE
// is exactly the parent's velocity whatever the kick did, and a build that gave its
// fragments a fresh velocity, or the bullet's, or none, reads a different number.
//
// READ OFF THE PAIR, AND OFF THE TICK THE ROUND LANDED. The average cancels the
// kick exactly, so no placement and no shot direction can leak into the figure; and
// the parent's velocity is read on the last tick it was still standing, so the well
// — which pulls every rock, `specs/gravity.md` — has had no chance to move one side
// of the comparison and not the other. That is fold-in fix C, kept as a property of
// the reading rather than as a placement that happens to be lucky.
//
// THE POSE IS THE REVIEW ITEM'S OWN: the parent stands at `(320, 620)`, `412` units
// from the star, drifting `(-60, -60)`, and it is shot HORIZONTALLY. The drift is
// diagonal against a horizontal shot on purpose — it is what makes the sibling item
// `fragment-kick-is-perpendicular-to-the-shot` decidable — and it costs this
// reading nothing, because a drift the average reproduces is a drift the average
// reproduces whichever way it points.
//
// THE TOLERANCE IS THE REVIEW ITEM'S FIGURE, `10` units per second. It is room for
// a build's own arithmetic and for the quarter of a unit per second the well adds
// to a fragment over the tick between the split and the reading — not room on the
// figure, which the specification fixes exactly. A build handing its fragments the
// bullet's travel instead reads `520` out; one handing them nothing reads `85` out.
//
// NOTHING ELSE IS ON THE FIELD: `startPlaying` empties every roster and shuts both
// world gates, and the round comes from the side facing away from the star, so
// `specs/collision.md`'s absorption at the core cannot take it on the way in.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { add, magnitude, scale, subtract } from "../geometry";
import {
  captureStill,
  createHarness,
  requireRock,
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

/** How far the average may fall from the parent's velocity: the item's figure. */
const TOLERANCE = 10;

/** Seconds of the pieces carrying the drift away, filmed after the reading. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands both fragments the parent's velocity, averaged over the pair", async () => {
  await startPlaying(h);
  const parentId = await poseRockAt(h, "large", QUIET_GROUND, FAN_DRIFT);

  const kill = await killHorizontally(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  await captureStill(h, "fan");

  const parent = requireRock(
    kill.before,
    parentId,
    "the Large on the tick before the fatal round landed",
  );
  const [a, b] = fragmentPair(
    kill.at,
    "medium",
    "fragment-velocity-carries-the-parent",
  );
  const average = scale(add(velocityOf(a), velocityOf(b)), 0.5);

  assertLessThanOrEqual(
    magnitude(subtract(average, velocityOf(parent))),
    TOLERANCE,
    "units per second between the fragments' average velocity and the parent's on the tick before the round landed (specs/collision.md)",
  );
});

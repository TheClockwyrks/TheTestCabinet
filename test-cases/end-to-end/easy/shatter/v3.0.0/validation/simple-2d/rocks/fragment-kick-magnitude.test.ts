// rocks/fragment-kick-magnitude — the fan opens at the width the specification fixes.
//
// `specs/collision.md`, The fragment fan: each fragment takes "a kick of
// `SPLIT_KICK` (`90`) perpendicular to the bullet's travel at the moment it landed,
// the two fragments kicked to opposite sides". This item decides the MAGNITUDE of
// that kick and nothing else — which line it lies across is
// `fragment-kick-is-perpendicular-to-the-shot`'s item, and that the pair straddles
// the parent's own course is `fragment-kick-opposite-sides`'.
//
// READ OFF THE PAIR, WHICH IS WHAT MAKES IT HONEST. The two kicks are equal and
// opposite, so the difference between the two fragments' velocities is exactly
// twice the kick and the parent's own motion — including every unit per second the
// well added to it on the way in — falls out. Half that difference is the kick and
// nothing else, so no placement of the parent can put the environment into the
// figure. That is the second half of fold-in fix C.
//
// AND IT IS READ ON THE TICK OF THE SPLIT. `specs/gravity.md` pulls both fragments,
// so a reading taken a second later would be a reading of the well; the kill
// reports the tick the parent left the roster and the pair is read there.
//
// THE TOLERANCE IS THE REVIEW ITEM'S FIGURE, a tenth of `SPLIT_KICK`, which is room
// for a build's own arithmetic and not room on the figure. A build that used the
// torpedo's `TORPEDO_SCATTER` (`240`) for the gun reads `150` out; one that kicked
// at the muzzle speed reads `430` out; one that kicked at nothing reads `90` out.
//
// THE POSE IS THE ONE THE TWO SIBLING FAN ITEMS NAME — the parent at `(320, 620)`
// drifting `(-60, -60)`, shot horizontally — so the whole fan group reads one
// scenario and a reviewer comparing their evidence is comparing like with like.

import { afterEach, beforeEach, it } from "vitest";
import { SPLIT_KICK } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  FAN_DRIFT,
  QUIET_GROUND,
  fragmentPair,
  kickOf,
  killHorizontally,
  lengthOf,
} from "./scene";

/** How far the kick may fall from `SPLIT_KICK`: a tenth of it, the item's figure. */
const TOLERANCE = 0.1 * SPLIT_KICK;

/** Seconds of the fan at its full width, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws each fragment off the parent's course at SPLIT_KICK", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    QUIET_GROUND.x,
    QUIET_GROUND.y,
    FAN_DRIFT.x,
    FAN_DRIFT.y,
  );

  const kill = await killHorizontally(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fan");

  const [a, b] = fragmentPair(kill.at, "medium", "fragment-kick-magnitude");

  assertLessThanOrEqual(
    Math.abs(lengthOf(kickOf(a, b)) - SPLIT_KICK),
    TOLERANCE,
    `units per second between half the fan's width and SPLIT_KICK (${SPLIT_KICK}) (specs/collision.md)`,
  );
});

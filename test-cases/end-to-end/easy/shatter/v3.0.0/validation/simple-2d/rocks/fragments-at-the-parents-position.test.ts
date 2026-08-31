// rocks/fragments-at-the-parents-position — the pieces stand where the parent stood.
//
// `specs/rocks.md`, Splitting: "Both fragments appear at the destroyed rock's
// position." One sentence, one requirement, and this item decides it alone: what
// the two pieces then CARRY is `specs/collision.md`'s fan and belongs to the three
// fragment-velocity items beside this one.
//
// THE PARENT IS POSED AT REST, which is what makes the reading exact. A drifting
// parent's last reported centre is a tick old by the time the round lands, so a
// check would have to model the build's tick order to say where it stood; at rest
// the well is the only thing that moves it, and at `412` units out that is `26`
// units per second squared — two thousandths of a unit over a tick. `addRock`
// places a rock at rest (`specs/instrumentation.md`), so this is the pose the
// surface gives and nothing is arranged beyond it.
//
// THE TOLERANCE IS ONE TICK OF THE FRAGMENT'S OWN TRAVEL, DOUBLED. The review item
// states one tick of travel. A build that creates the pieces and then runs the
// tick's motion over them has moved each one a full tick before the snapshot is
// taken, and a build that runs its motion first has moved them none; the doubling
// admits both without admitting anything else. At the kick `specs/collision.md`
// fixes (`SPLIT_KICK`, `90`) that is a unit and a half, against a Large's radius of
// `46` — so a build that scatters the pair around the parent's rim, or drops them
// at the field's origin, fails by thirty times the bound and more.
//
// NOTHING ELSE IS ON THE FIELD. `startPlaying` empties every roster and shuts both
// world gates, and the round is placed on the parent's doorstep on the side facing
// away from the star, so `specs/collision.md`'s absorption at the core cannot take
// it on the way in.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { distance, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  type Harness,
} from "../harness";
import { QUIET_GROUND, centreOf, fragmentPair, killRock } from "./scene";

/**
 * How many ticks of a fragment's own travel it may stand from where its parent
 * died.
 *
 * One, as the review item states, doubled so that a build which steps a fresh
 * fragment on the tick it was born and one which steps it on the next both clear
 * the bound. It is measured at the fragment's OWN reported speed, so the figure is
 * the piece's real travel rather than a number this file made up.
 */
const TRAVEL_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands both fragments where the destroyed rock last stood", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);

  const kill = await killRock(h, parentId);
  captureStill(h, "fragments");

  const parent = rockById(
    kill.before,
    parentId,
    "the Large on the tick before the fatal round landed",
  );
  const fragments = fragmentPair(
    kill.at,
    "medium",
    "fragments-at-the-parents-position",
  );

  for (const [index, fragment] of fragments.entries()) {
    assertLessThanOrEqual(
      distance(centreOf(parent), centreOf(fragment)),
      TRAVEL_TICKS * speedOf(fragment) * TICK_DT,
      `units fragment ${index + 1} stands from the destroyed rock's last reported centre (specs/rocks.md)`,
    );
  }
});

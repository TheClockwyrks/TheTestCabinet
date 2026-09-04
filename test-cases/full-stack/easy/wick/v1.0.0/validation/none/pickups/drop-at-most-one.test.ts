// pickups/drop-at-most-one — a common kill drops at most one of bread and a
// draft.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "A first
// draw, uniform on `[0, 1)`, drops bread when it is below `BREAD_CHANCE`. Only
// when it did not, a second draw drops a draft when it is below `DRAFT_CHANCE`.
// A kill therefore drops at most one of the two, and the pickup lands at the
// enemy's position beside its gem." So the draft draw is conditional on the
// bread draw having failed, and no kill can leave two pickups.
//
// WHAT THE READING IS. Every pickup a kill drops lands "at the enemy's
// position", so two pickups sharing a center is exactly one kill having dropped
// both, and the check is that no center in the sample carries two. A conformant
// build leaves none with certainty, whatever the seed, so the check has no tail
// of its own; what a sample buys is the chance of catching a build that leaves
// two.
//
// WHY THIS CHECK'S SAMPLE IS ITS OWN, AND LARGER. A build that draws for a
// draft on every kill regardless of the bread draw leaves two on
// `BREAD_CHANCE × DRAFT_CHANCE` of its kills, four tenths of a kill over the
// `DROP_ROLL_KILLS` (`4000`) the counting checks share, so that design escapes
// a sample that size more often than not. This check therefore poses
// `DROP_PAIR_KILLS` (`60000`) kills of its own, where the same design leaves
// six expected and escapes about one time in four hundred. A build that drops
// both at any material rate leaves several either way.
//
// WHY THE WORLD IS POSED AS IT IS. `sweepCommonKills` in `./stage` poses the
// sample: an isolated night, every driver switch off and no slot held, so the
// only draws the ticks make are the kills' own; `DROP_PAIR_KILLS` real kills of
// a moth by a level-1 Ember bolt, each at its own point, no two of the sixty
// thousand points coinciding and every one far outside the radii that attract or
// collect. So a pickup's center names the kill that dropped it. The field is
// swept between rounds, so each round's pickups are that round's drops; a kill's
// two possible drops land at one point on one tick, so a round is the whole of
// the window in which two pickups could share a center.
//
// THE TOLERANCE. None: two centers are the same point or they are not. A center
// is compared as the exact pair the snapshot reports, which is a copy of the
// position the kill was posed at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DROP_PAIR_KILLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sweepCommonKills } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no two pickups on one center over 60000 seeded common kills", async () => {
  const sweep = await sweepCommonKills(h, DROP_PAIR_KILLS);
  await captureStill(h, "one");

  assertEqual(sweep.kills, DROP_PAIR_KILLS, "the kills the sample made");
  const shared: string[] = [];
  for (const round of sweep.rounds) {
    const seen = new Map<string, number>();
    for (const pickup of round.pickups) {
      const center = `${pickup.x},${pickup.y}`;
      const count = (seen.get(center) ?? 0) + 1;
      seen.set(center, count);
      if (count > 1) shared.push(center);
    }
  }
  assertEqual(
    shared.length,
    0,
    "the centers carrying more than one pickup over the sample",
  );
});

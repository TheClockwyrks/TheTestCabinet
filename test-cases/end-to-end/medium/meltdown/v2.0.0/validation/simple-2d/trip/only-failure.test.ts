// Meltdown — trip/only-failure: the trip is the only failure.
//
// specs/heat.md closes with the sentence this item is: "The trip is an emitter's
// only failure. A tower is never destroyed, never damaged by the surge, and never
// runs out of ammunition." It is the rule that makes Meltdown's towers walls
// rather than units — nothing on the floor can take one away, and the only thing
// that ever silences one is its own heat.
//
// THE ONE INTEGRATION CHECK IN THIS GROUP. Every other item here poses a state
// and reads one consequence of it. This one poses a tower under sustained load
// and runs the real systems — targeting, the fire clock, the heat model, the
// trip — for a minute of game time, because what it decides is a NEGATIVE across
// a long stretch: that nothing over that minute ever took the tower off the
// floor, damaged it, or silenced it for a reason that was not a cooldown.
//
// THE CROWD IS FORTY UNITS THAT NEVER DIE AND NEVER LEAVE. Each has its motion
// off, so none walks out of range, none reaches an exhaust and none costs a life,
// and each carries hp far past a minute of any emitter's fire, so none dies. That
// keeps the reading on the TOWER: the gun always has a target, so every frame it
// is not firing is a frame it was offline, and `kills` never moves, so a tally
// that did move would be the build inventing one. All forty stand within five
// tiles of the Arc's footprint centre, inside the `6.0`-tile range specs/towers.md
// gives it.
//
// THE TOWER TRIPS SEVERAL TIMES OVER THE MINUTE, WHICH IS THE POINT. specs/towers.md
// gives the Arc `2.0` shots a second at `heatPerShot` `10.3` and mass `1.0`, so
// firing continuously it takes on `20.6` heat a second while shedding at most
// `(3.6 * 4 + 1.1 * 4)`, which is `18.8` a second at heat `100` (specs/heat.md).
// It therefore climbs to the trip, goes dark for `TRIP_TIME`, comes back cold and
// climbs again — about eighteen seconds a cycle. So the minute contains real
// offline periods, and the reading "every offline period is a cooldown" is a
// reading of something rather than of an empty set.
//
// HOW "OFFLINE" IS COUNTED. Every frame is sampled, and a frame that reports
// `firing` false while `tripped` is false is an offline frame the trip does not
// account for. What is asserted is the LONGEST RUN of them, not the total: an
// offline PERIOD is what the rule is about, and a build is free to resolve the
// end of a cooldown anywhere inside the frame that crosses it — specs/combat.md
// has the emitters pick their targets before specs/heat.md's pass runs, so the
// frame a cooldown ends on may legally still report `firing` false. One frame
// either side of that boundary is the whole of the room; a tower that has been
// destroyed, damaged into silence or left without ammunition is offline for
// thousands of frames together.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_TIME } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { CROWD_SITE, poseCrowd } from "./bench";

/** The tower held under the crowd. */
const TOWER = "arc";

/** The crowd: how many units, and how far out they stand, in tiles. */
const CROWD = 40;
const CROWD_RADIUS = 5;

/** How long the tower is held, in seconds of game time. */
const HELD_SECONDS = 60;

/** The stretch at the end over which the gun must still be doing damage. */
const TAIL_SECONDS = 10;

/**
 * The longest run of frames the tower may report neither firing nor tripped.
 *
 * Two frames, which is one either side of the boundary a cooldown ends on: the
 * simulation resolves combat before the heat pass (specs/combat.md,
 * specs/heat.md), so the frame that brings a tower back online has already picked
 * its targets and may legally report `firing` false. `0.017` s is a third of one
 * percent of a `5.0` s cooldown, and every failure this item exists to catch —
 * a tower destroyed, silenced by damage, or out of ammunition — is offline for
 * the rest of the minute.
 */
const MAX_OFFLINE_RUN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The trip is the only failure", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, CROWD_SITE.col, CROWD_SITE.row);
  poseCrowd(h, TOWER, CROWD_SITE, CROWD, CROWD_RADIUS);

  const opened = towerOf(h.snapshot(), id);
  const frames = ticksFor(HELD_SECONDS);
  const tailOpensAt = frames - ticksFor(TAIL_SECONDS);

  let trips = 0;
  let wasTripped = false;
  let offlineRun = 0;
  let longestOfflineRun = 0;
  let longestAt = 0;
  let dealtAtTail = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    await h.advance(1);
    const tower = towerOf(h.snapshot(), id);
    if (tower.tripped && !wasTripped) trips += 1;
    wasTripped = tower.tripped;
    if (!tower.firing && !tower.tripped) {
      offlineRun += 1;
      if (offlineRun > longestOfflineRun) {
        longestOfflineRun = offlineRun;
        longestAt = frame + 1;
      }
    } else {
      offlineRun = 0;
    }
    if (frame + 1 === tailOpensAt) dealtAtTail = tower.damageDealt;
  }
  captureStill(h, "intact");

  const closed = towerOf(h.snapshot(), id);

  assertEqual(
    closed.type,
    opened.type,
    `the type of the ${TOWER} after ${HELD_SECONDS}s under ${CROWD} units`,
  );
  assertEqual(
    `${closed.col},${closed.row},${closed.size}`,
    `${opened.col},${opened.row},${opened.size}`,
    `the footprint of the ${TOWER} after ${HELD_SECONDS}s under ${CROWD} units`,
  );
  assertEqual(
    closed.level,
    opened.level,
    `the level of the ${TOWER} after ${HELD_SECONDS}s under ${CROWD} units`,
  );

  assertGreaterThan(
    trips,
    0,
    `trips a ${TOWER} firing without pause for ${HELD_SECONDS}s took, which ` +
      `specs/towers.md's and specs/heat.md's figures put at about one every ` +
      `eighteen seconds`,
  );
  assertLessThanOrEqual(
    longestOfflineRun,
    MAX_OFFLINE_RUN,
    `the longest run of frames the ${TOWER} was neither firing nor tripped, ` +
      `which ended ${seconds(longestAt).toFixed(3)}s in; every offline ` +
      `period must be one of its ${TRIP_TIME}s cooldowns`,
  );
  assertGreaterThan(
    closed.damageDealt - dealtAtTail,
    0,
    `damage the ${TOWER} dealt over the last ${TAIL_SECONDS}s of the minute`,
  );
});

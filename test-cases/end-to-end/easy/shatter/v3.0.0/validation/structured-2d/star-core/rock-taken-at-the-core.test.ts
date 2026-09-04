// star-core/rock-taken-at-the-core — the star takes a rock off its own doorstep.
//
// THE RULE. `specs/collision.md`'s pair table: "A rock and the core | THE ROCK
// IS RECYCLED, as `specs/rocks.md` states. Nothing scores." `specs/rocks.md`
// spells the recycling out: "When a rock's circle reaches the star's core, the
// rock is taken from the core and immediately re-placed". This item is the
// TAKEN half — that the rock is off the core the tick after it reached it — and
// nothing else. Where it comes back, how fast, at what size, and that the count
// holds are the five `rocks/recycle-*` points; that it scores nothing is
// `scoring/recycling-scores-nothing`'s.
//
// WHAT IS READ. Every rock on the field, two ticks after the tick whose swept
// path first brought the rock's circle to the core: none of them may overlap it.
// A build that obeys the rule has put the rock back on an edge of the field, at
// least `360` units from the star's centre; a build that lets a rock sail
// through the star still has it inside `CORE_R + ROCK_RADIUS.small` and reads a
// negative clearance.
//
// WHY THE TICK IS WORKED OUT RATHER THAN WATCHED FOR. `specs/simulation.md`
// resolves collision inside the tick, so no snapshot exists in which the rock is
// sitting at the core waiting to be taken: by the time a check can look, a
// conforming build has already re-placed it. `driveTheRockIn` therefore puts
// each tick of the rock's OWN readings through `specs/collision.md`'s swept test
// against the core and stops on the first that contains the contact. That test
// is the specification's, run on the build's numbers, so it identifies the tick
// without assuming anything about what the build did on it.
//
// AND WHY THE READING IS TWO TICKS ON RATHER THAN ONE. A tick of slack, because
// the reconstruction above is run one tick of the well's pull ahead of the
// build's own reading and so may fire a tick early. It costs a wrong build
// nothing: a rock that sailed through is `2` units further INSIDE the core after
// the extra tick, not less.
//
// WHY THE ROCK IS SMALL AND AIMED DEAD AT THE CENTRE. Small, so its circle
// reaches the core at `44` units from the centre — the tightest of the three
// sizes, and so the least room for a build's contact radius to be wrong in a way
// this point should not be grading. Dead at the centre, because
// `specs/gravity.md` pulls a rock along the direct vector to `(STAR_X, STAR_Y)`:
// on that line the well brings the rock in sooner and bends it nowhere, so the
// contact is the one this check arranged rather than one the well steered into.
// It closes at `TAKE_SPEED`, which sits inside a Small's own drift band
// (`specs/rocks.md`), so the scenario asks the game for nothing a wave would
// not.
//
// THE ROCK IS THE FIELD'S ONE ROCK, FOUND IN THE ROSTER AND NOT BY ITS ID.
// `specs/rocks.md` makes a recycled rock "the same rock relocated, not a fresh
// one" but never says its id survives, so a check that followed one would be
// demanding something the specification does not.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, ROCK_RADIUS } from "../constants";
import { assertGreaterThan } from "../assert";
import { DEG } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  aroundTheStar,
  coreClearance,
  driveTheRockIn,
  inwardFrom,
  theOneRock,
} from "./approach";

/** How far from the star's centre the rock starts, in units. */
const RANGE = 120;

/** The bearing it comes in on: off every axis and every diagonal. */
const BEARING = 250 * DEG;

/**
 * The speed it closes at, in units per second: `200`, inside a Small's own base
 * drift band of `130` to `210` (`specs/rocks.md`), so the approach is an
 * ordinary drift rather than a speed the game never produces.
 */
const TAKE_SPEED = 200;

/**
 * How long the rock is followed before the drive gives up, in ticks: `1.5`
 * seconds of game time.
 *
 * The rock covers the `76` units between it and the core in under `0.4` seconds
 * at `TAKE_SPEED` before the well is counted, and sooner with it, so a drive
 * that runs out has found a rock that is not falling rather than a scenario cut
 * short.
 */
const DRIVE_TICKS = ticksFor(1.5);

/** The distance at which a Small's circle rests on the core, in units. */
const SURFACE = CORE_R + ROCK_RADIUS.small;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("has the rock off the core the tick after its circle reached it", async () => {
  startPlaying(h);

  const from = aroundTheStar(RANGE, BEARING);
  const at = inwardFrom(from, TAKE_SPEED);
  poseRock(h, "small", from.x, from.y, at.vx, at.vy);

  const take = await driveTheRockIn(h, DRIVE_TICKS);

  // The core the instant after it took the rock.
  captureStill(h, "taken");

  const rock = theOneRock(take.after, "the rock the star took");
  const clearance = coreClearance(rock, rock.radius);

  assertGreaterThan(
    clearance,
    0,
    "the rock to be off the core the tick after its circle reached it: the " +
      "star takes a rock from the core and re-places it (specs/rocks.md, " +
      "specs/collision.md). The clearance is the rock's distance from the " +
      `star's centre less CORE_R + ROCK_RADIUS.small (${SURFACE}), so zero ` +
      "and below is a rock still touching the core — a rock the star let " +
      "sail straight through reads well below it. It came in at " +
      `${take.approaching.x.toFixed(1)}, ${take.approaching.y.toFixed(1)} ` +
      `and is now ${rock.x.toFixed(1)}, ${rock.y.toFixed(1)}`,
  );
});

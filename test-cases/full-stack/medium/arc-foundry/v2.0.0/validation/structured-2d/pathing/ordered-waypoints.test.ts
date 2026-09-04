// pathing/ordered-waypoints — a ground unit reaches every checkpoint of the chain
// in order, and grounds out at the collector.
//
// `specs/pathing.md` builds the whole game on this ordering: the route the player
// lengthens is the route THROUGH the chain, and a unit that skips a checkpoint or
// reorders two of them walks a shorter yard than the one the maze was built for.
// `specs/instrumentation.md` numbers the checkpoint a unit is heading for from
// `1`, with `7` the collector, and says the number never decreases.
//
// SO ONE UNIT IS WATCHED THE WHOLE WAY. The values it reports are collected as it
// walks, and the sequence of distinct values has to be exactly `1` through `7`:
// no skip, no repeat out of order, and nothing left over. The walk ends where
// `specs/pathing.md` ends it, with the unit removed at the collector.

import { afterEach, beforeEach, it } from "vitest";

import { assertDeepEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";

/** The chain a unit walks: the six waypoints, then the collector. */
const CHECKPOINTS = [1, 2, 3, 4, 5, 6, 7];

/** The multiplier the walk is watched at, and how often it is sampled. */
const WALK_SPEED = 8;
const SAMPLE_FRAMES = 2;
const MAX_SAMPLES = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("heads for each checkpoint in turn and grounds out at the collector", async () => {
  openYard(h, { wave: 1, speed: WALK_SPEED });

  const walk = await captureReplay(h, "walk", async () => {
    const id = releaseUnit(h, "spark");
    const seen: number[] = [];
    let grounded = false;
    for (let sample = 0; sample < MAX_SAMPLES && !grounded; sample += 1) {
      await h.advance(SAMPLE_FRAMES);
      const unit = h.snapshot().units.find((live) => live.id === id);
      if (unit === undefined) {
        grounded = true;
        break;
      }
      if (seen[seen.length - 1] !== unit.waypointIndex) {
        seen.push(unit.waypointIndex);
      }
    }
    return { seen, grounded };
  });

  assertDeepEqual(
    walk.seen,
    CHECKPOINTS,
    "the checkpoints a ground unit headed for, in the order it headed for " +
      "them: 1 through 6 are the numbered waypoints and 7 is the collector " +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    walk.grounded,
    "the unit to ground out at the collector and be removed, which is where " +
      "the chain ends (specs/pathing.md)",
  );
});

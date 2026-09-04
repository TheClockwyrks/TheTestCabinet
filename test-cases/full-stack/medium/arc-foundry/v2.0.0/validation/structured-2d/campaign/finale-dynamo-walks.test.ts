// campaign/finale-dynamo-walks — the Overload Dynamo walks the chain at 55.
//
// specs/campaign.md's finale: "A single Overload Dynamo spawns at the entry and
// walks the chain to the collector, taking the open route of least length exactly
// as any ground unit does." specs/enemies.md gives its speed as `55` and says the
// same of its route. specs/pathing.md fixes what "the open route of least length"
// measures: a route's length is the sum of its steps in tiles, an orthogonal step
// `1` and a diagonal `sqrt(2)`, and the maze length is "the total length of the
// ground route the Load walks from the entry through every waypoint in order to
// the collector, over the yard as it currently stands, in tiles" — which
// specs/instrumentation.md reports live as `mazeLength`.
//
// So the whole walk is sampled, from the finale opening to the frame the Dynamo
// grounds out, and three things are read off it.
//
// WHERE IT STARTS. One unit, of type `overload`, standing at the entry. The
// finale's opening is found by sampling, so the Dynamo has had up to one sample
// of walking by the time it is first read; what is asserted is that it is within
// that half-second of travel of the entry tile's center, and the run-up is added
// back into the distance the route comparison below is made against.
//
// HOW FAST. Its reported speed is `55`, and the distance it actually covered is
// `55` times the time it took — a build reporting one figure and moving at
// another fails on the second.
//
// WHICH ROUTE. `waypointIndex` never decreases, passes through every checkpoint
// from `1` to `7`, and the distance covered matches the live maze length in
// tiles. A Dynamo that cut a corner of the chain covers less; one that wandered
// covers more.
//
// The yard carries the one Regulator the last level's harvest left standing, and
// `mazeLength` is read at the moment of the walk, so the figure compared against
// is the maze the Dynamo actually walked.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import { OVERLOAD_SPEED, TILE } from "../../src/constants";
import { captureReplay, distance, tileCenter, type Harness } from "../harness";
import {
  CLEAR_POLL,
  createRunHarness,
  onlyUnit,
  reachFinale,
  RUN_HZ,
} from "./runs";

const DIFFICULTY = "easy";

/** Frames between two samples of the walk: `2.75` units of travel apart. */
const POLL = 2;

/** Two minutes of simulation: past any maze this game can hold. */
const MAX_FRAMES = 120 * RUN_HZ;

/** The route is sampled as chords, so the sum runs a shade under the true length. */
const TOLERANCE = 0.03;

/** How far the Dynamo may already have walked when the finale is first read. */
const LEAD = (OVERLOAD_SPEED * (CLEAR_POLL + 1)) / RUN_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("walks the whole chain from the entry to the collector at OVERLOAD_SPEED", async () => {
  const { cleared } = await reachFinale(h, DIFFICULTY);
  const opening = cleared.snapshot;
  assertLength(opening.units, 1, "the finale releases one unit");

  const dynamo = onlyUnit(opening, "overload");
  const entry = tileCenter(opening.entry.col, opening.entry.row);
  const lead = distance({ x: dynamo.x, y: dynamo.y }, entry);
  assertLessThan(
    lead,
    LEAD,
    "the Overload Dynamo spawns at the entry, read within one sample of the " +
      "finale opening",
  );
  assertCloseTo(
    dynamo.baseSpeed,
    OVERLOAD_SPEED,
    6,
    "the Overload Dynamo's speed",
  );
  assertEqual(dynamo.waypointIndex, 1, "it heads for WP1 first");

  const walk = await captureReplay(h, "walk", async () => {
    const mazeLength = opening.mazeLength;
    let at = { x: dynamo.x, y: dynamo.y };
    let covered = 0;
    let checkpoint = dynamo.waypointIndex;
    const visited = new Set<number>([checkpoint]);
    let backwards = 0;
    let frames = 0;
    let speed = dynamo.speed;

    for (;;) {
      await h.advance(POLL);
      frames += POLL;
      const s = h.snapshot();
      const live = s.units.find((unit) => unit.id === dynamo.id);
      if (live === undefined) {
        // It grounded out: the last leg ends at the collector's tile center.
        covered += distance(at, tileCenter(s.collector.col, s.collector.row));
        return {
          covered,
          seconds: frames / RUN_HZ,
          visited: [...visited].sort((a, b) => a - b),
          backwards,
          speed,
          mazeLength,
        };
      }
      covered += distance(at, { x: live.x, y: live.y });
      at = { x: live.x, y: live.y };
      speed = live.speed;
      if (live.waypointIndex < checkpoint) backwards += 1;
      checkpoint = live.waypointIndex;
      visited.add(checkpoint);
      if (frames >= MAX_FRAMES) {
        return {
          covered,
          seconds: frames / RUN_HZ,
          visited: [...visited].sort((a, b) => a - b),
          backwards,
          speed,
          mazeLength,
        };
      }
    }
  });

  assertCloseTo(
    walk.speed,
    OVERLOAD_SPEED,
    6,
    "the Overload Dynamo carries no slow, so it walks at its own speed",
  );
  assertEqual(walk.backwards, 0, "its checkpoint never goes backwards");
  assertEqual(
    walk.visited.join(", "),
    [1, 2, 3, 4, 5, 6, 7].join(", "),
    "it heads for every checkpoint of the chain in order, the collector last",
  );
  assertCloseTo(
    walk.covered / (OVERLOAD_SPEED * walk.seconds),
    1,
    2,
    `it covered ${walk.covered.toFixed(1)} units in ` +
      `${walk.seconds.toFixed(2)} s, against ${OVERLOAD_SPEED} a second`,
  );
  const ratio = (lead + walk.covered) / (walk.mazeLength * TILE);
  assertEqual(
    ratio > 1 - TOLERANCE && ratio < 1 + TOLERANCE,
    true,
    `it covered ${(walk.covered / TILE).toFixed(1)} tiles against the maze's ` +
      `own ${walk.mazeLength.toFixed(1)}, within ${TOLERANCE * 100}%`,
  );
});

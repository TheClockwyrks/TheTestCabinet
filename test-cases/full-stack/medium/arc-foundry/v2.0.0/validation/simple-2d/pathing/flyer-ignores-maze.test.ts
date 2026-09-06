// pathing/flyer-ignores-maze — the Filament flies the straight-line chain, and a
// maze standing under it changes neither its path nor how long it takes.
//
// THE FLYER IS THE ANSWER TO A MAZE, which is why `specs/enemies.md` puts one in
// every fourth wave: a player who has walled the yard into a spiral still has to
// cover the straight line from the entry to the collector. `specs/pathing.md`
// says it in as many words — a flying unit ignores the maze, flies in straight
// lines from the entry through each waypoint anchor in order, and no wall slows
// or redirects it.
//
// SO THE SAME FLIGHT IS FLOWN TWICE, once over an empty yard and once under a
// maze heavy enough to move the ground route a long way, and the two are compared
// sample for sample and frame for frame. Nothing else about the two flights
// differs: the same speed multiplier, the same clock, the same unit, released
// from the same entry.
//
// THE CLOCK IS THE CHECK'S. Both flights are a SPAN rather than a reading, and
// specs/instrumentation.md guarantees that "an interval of simulation time
// reaches the same state however it was divided into frames and whatever frame
// rate produced it", so they are flown at {@link FLIGHT_HZ}.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  distance,
  type Harness,
  openYard,
  releaseUnit,
  standBlocker,
} from "../harness";
import type { Point } from "../constants";

/** Fifteen footprints laid across the straight lines the chain flies. */
const MAZE = [
  { col: 10, row: 4 },
  { col: 14, row: 4 },
  { col: 18, row: 4 },
  { col: 22, row: 4 },
  { col: 10, row: 13 },
  { col: 14, row: 13 },
  { col: 18, row: 13 },
  { col: 22, row: 13 },
  { col: 10, row: 26 },
  { col: 14, row: 26 },
  { col: 18, row: 26 },
  { col: 22, row: 26 },
  { col: 43, row: 10 },
  { col: 43, row: 14 },
  { col: 43, row: 18 },
];

/** The rate both flights are flown at. */
const FLIGHT_HZ = 15;

/** The multiplier the flight is watched at, and how often it is sampled. */
const FLIGHT_SPEED = 8;
const SAMPLE_FRAMES = 1;
const MAX_SAMPLES = 300;

/** How far apart two samples of the same flight may be, in logical units. */
const TOLERANCE = 0.5;

/** One flight: where the flyer was at each sample, and how long it lasted. */
interface Flight {
  path: Point[];
  frames: number;
  mazeLength: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: FLIGHT_HZ });
});

afterEach(() => {
  h?.dispose();
});

/** Fly one Filament from the entry to the collector, sampling as it goes. */
async function fly(walled: boolean): Promise<Flight> {
  openYard(h, { wave: 1, speed: FLIGHT_SPEED });
  if (walled) {
    for (const at of MAZE) standBlocker(h, at.col, at.row);
  }
  const { mazeLength } = h.snapshot();

  const id = releaseUnit(h, "filament");
  const path: Point[] = [];
  let frames = 0;
  for (let sample = 0; sample < MAX_SAMPLES; sample += 1) {
    await h.advance(SAMPLE_FRAMES);
    const unit = h.snapshot().units.find((live) => live.id === id);
    if (unit === undefined) break;
    path.push({ x: unit.x, y: unit.y });
    frames += SAMPLE_FRAMES;
  }
  return { path, frames, mazeLength };
}

it("flies the same line, in the same time, with a heavy maze under it", async () => {
  const open = await fly(false);
  const maze = await captureReplay(h, "flyover", () => fly(true));

  // The maze really is standing: the ground route around it is far longer than
  // the one over the empty yard, so a flyer that felt walls at all would show it.
  assertGreaterThan(
    maze.mazeLength,
    open.mazeLength,
    `the ground route with ${MAZE.length} footprints across the chain, ` +
      `against the ${open.mazeLength} of the empty yard`,
  );
  assertGreaterThan(
    open.path.length,
    0,
    "the samples taken of the flight over the empty yard",
  );

  // And the flight is the same flight.
  assertLength(
    maze.path,
    open.path.length,
    "the samples the flight over the maze lasted, against the flight over the " +
      "empty yard: a flyer's arrival is not delayed by a wall",
  );
  for (const [at, over] of maze.path.entries()) {
    assertLessThan(
      distance(over, open.path[at]!),
      TOLERANCE,
      `sample ${at} of the flight: where the Filament flew over the maze ` +
        `(${over.x.toFixed(2)}, ${over.y.toFixed(2)}) against where it flew ` +
        `over the empty yard (${open.path[at]!.x.toFixed(2)}, ` +
        `${open.path[at]!.y.toFixed(2)})`,
    );
  }
});

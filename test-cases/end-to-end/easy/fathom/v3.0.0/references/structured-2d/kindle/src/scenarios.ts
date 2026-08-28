// Fathom — the fixtures and the arrangements the build's own tests pose.
//
// A scenario fixes GEOMETRY and nothing else: what every test then asserts is
// the figure the specification states, written out in the test itself. Each
// fixture carries a sealed larder — a short corridor walled off from the rest —
// so `planktonRemaining` never reaches zero and no amount of grazing clears the
// maze in the middle of a measurement.

import { anchor, stampLayout, type Fixture } from "./fixtures";
import type { Cell } from "./grid";
import type { FathomDebugApi } from "./debug";

/** A long straight hall, the forager at `F` and a hunter's mark at `P`. */
export const HALL: readonly string[] = [
  "###########",
  "#F.......P#",
  "###########",
  "           ",
  "   #####   ",
  "   #...#   ",
  "   #####   ",
];

/**
 * A rock spine between the two: a hunter at `P` reaches `F`'s row only by
 * rounding it, so no step of the route may stand on rock.
 */
export const SPINE: readonly string[] = [
  "#######",
  "#P....#",
  "#####.#",
  "#F....#",
  "#######",
  "       ",
  " ##### ",
  " #...# ",
  " ##### ",
];

/**
 * A long hall for the forager at `F`, and a sealed one-tile perch at `X` well
 * past every reach the specification gives a hunter, so a creature posed there
 * runs its own timers where nothing it does can reach the forager and nothing
 * the forager does can reach it.
 */
export const PERCH: readonly string[] = [
  "#####################",
  "#F..................#",
  "#####################",
  "###################X#",
  "#####################",
  "                     ",
  "   #####             ",
  "   #...#             ",
  "   #####             ",
];

/** A den chamber with its one gate above it, sealed on the other three sides. */
export const DEN: readonly string[] = [
  "##########",
  "#F.......#",
  "####g#####",
  "####d#####",
  "##########",
  "          ",
  "  #####   ",
  "  #...#   ",
  "  #####   ",
];

/** Stamp a fixture and pose it, leaving the forager on its named anchor. */
export function pose(
  debug: FathomDebugApi,
  art: readonly string[],
  at = "F",
): Fixture {
  const fixture = stampLayout(art);
  debug.setMaze(fixture.rows);
  const start = anchor(fixture, at);
  debug.setForagerTile(start.tx, start.ty);
  return fixture;
}

/** The tile a fixture named. */
export function at(fixture: Fixture, name: string): Cell {
  return anchor(fixture, name);
}

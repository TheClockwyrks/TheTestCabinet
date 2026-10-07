// Fathom — the trench this build lays out.
//
// `specs/maze.md` leaves the layout to the build and fixes the rules it has to
// satisfy: one-tile-wide corridors, mirror symmetry about the axis between
// columns 17 and 18, a solid border pierced only by the wrap tunnel, no dead
// ends, one connected corridor region, an enclosed den with a single gate, and
// the three proportions. This layout satisfies all of them, and
// `src/maze-rules.ts` measures it — `src/layout.test.ts` holds the trench to
// every rule so a change to it cannot quietly break one.
//
// `specs/progression.md` leaves the layout of the next maze a free choice, and
// this build dives the same trench at every depth: what a deeper maze changes
// is the roster it holds and the reach of the sonar.

import type { Cell } from "./grid";

/**
 * The trench, one string per row from the top, in the alphabet
 * `specs/state.md` reports: `#` rock, `.` corridor, `g` the den gate, and `d`
 * den interior.
 */
export const TRENCH: readonly string[] = [
  "####################################",
  "#..................................#",
  "#.###.#.#######.####.#######.#.###.#",
  "#.....#.....#..........#.....#.....#",
  "#.#######.#.#.#.####.#.#.#.#######.#",
  "#.........#...#......#...#.........#",
  "###.#.#.#####.###g####.#####.#.#.###",
  "#...#.#.....#.##dddd##.#.....#.#...#",
  "#.#.#.#####.#.##dddd##.#.#####.#.#.#",
  "#.#.......#...##dddd##...#.......#.#",
  "#.###.###.################.###.###.#",
  "#...#..........................#...#",
  "#.#.#.#####.############.#####.#.#.#",
  "..#.#.......#..........#.......#.#..",
  "#.#.###.#.###.#.####.#.###.#.###.#.#",
  "#.......#.....#......#.....#.......#",
  "####################################",
  "####################################",
];

/**
 * Where the forager begins the trench and returns to at the start of each life:
 * a corridor tile in the lower half of the grid, on the axis of the mirror.
 */
export const TRENCH_START: Cell = { tx: 17, ty: 15 };

/**
 * The den tiles predators are parked on, filling the chamber from its middle
 * outward. Only the ones the standing layout actually marks as den are used, so
 * a posed fixture with a den somewhere else falls back to its own den tiles.
 */
export const DEN_SLOTS: readonly Cell[] = [
  { tx: 17, ty: 8 },
  { tx: 18, ty: 8 },
  { tx: 16, ty: 8 },
  { tx: 19, ty: 8 },
  { tx: 17, ty: 7 },
  { tx: 18, ty: 7 },
];

// Fathom — the fixtures and the arrangements the build's own tests pose.
//
// A scenario fixes GEOMETRY and nothing else: what every test then asserts is
// the figure the specification states, written out in the test itself. A posed
// board carries no plankton, so nothing a measurement does can clear the maze
// under it and the bonus cadence admits nobody while it runs
// (`specs/gameplay.md`); a test that wants a plankton puts one where it wants
// it.

import { anchor, stampLayout, type Fixture } from "./fixtures";
import type { Cell } from "./grid";
import type { FathomDebugApi } from "./debug";

/** A long straight hall, the forager at `F` and a hunter's mark at `P`. */
export const HALL: readonly string[] = [
  "###########",
  "#F.......P#",
  "###########",
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
];

/** A den chamber with its one gate above it, sealed on the other three sides. */
export const DEN: readonly string[] = [
  "##########",
  "#F.......#",
  "####g#####",
  "####d#####",
  "##########",
];

/**
 * Stamp a fixture and pose it: the layout, an empty board, and the forager at
 * rest on its named anchor. What else the scenario holds is the test's to add.
 */
export function pose(
  debug: FathomDebugApi,
  art: readonly string[],
  at = "F",
): Fixture {
  const fixture = stampLayout(art);
  debug.setMaze(fixture.rows);
  debug.clearPlankton();
  const start = anchor(fixture, at);
  debug.setForagerTile(start.tx, start.ty);
  return fixture;
}

/** The tile a fixture named. */
export function at(fixture: Fixture, name: string): Cell {
  return anchor(fixture, name);
}

/**
 * Every creature standing in the maze with its own mind running, or with every
 * one of them off. A creature added later brings its mind on, so a scenario
 * that wants it still calls this again once the maze holds what it is about.
 */
export function minds(debug: FathomDebugApi, running: boolean): void {
  const snapshot = debug.snapshot();
  for (let index = 0; index < snapshot.predators.length; index++) {
    debug.setPredatorMind(index, running);
  }
  for (let index = 0; index < snapshot.drifters.length; index++) {
    debug.setDrifterMind(index, running);
  }
}

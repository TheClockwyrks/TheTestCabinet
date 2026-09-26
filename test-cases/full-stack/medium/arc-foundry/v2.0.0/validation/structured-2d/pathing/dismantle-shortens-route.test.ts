// pathing/dismantle-shortens-route — dismantling clears a structure's four tiles
// back to Open and recomputes the route, so the maze length returns to exactly
// what it was.
//
// `specs/pathing.md` names dismantling as one of the two ways the walls change,
// and `specs/scrap-press.md` makes it the player's only way to undo a placement.
// A build that removes the structure from the yard without reopening its tiles
// leaves a wall nothing is drawn on: the maze length stays up, the player pays
// for a mistake that is no longer there, and nothing on the screen explains it.
//
// THE MEASUREMENT IS EXACT, not approximate: the yard is in the same state it
// was, so the figure is the same figure. The comparison is against the reading
// taken before the placement rather than against a computed length, which is what
// keeps this about the dismantle rather than about the pathfinder.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";

/** The wall: three footprints stacked across the Entry -> WP1 leg at row 5. */
const WALL_COL = 20;
const WALL_ROWS = [2, 4, 6];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the maze length to its reading before the placement", async () => {
  openYard(h);
  const empty = h.snapshot().mazeLength;

  const standing = WALL_ROWS.map((row) =>
    standCandidate(h, "capacitor", 1, WALL_COL, row),
  );
  const walled = h.snapshot().mazeLength;
  assertGreaterThan(
    walled,
    empty,
    `the maze length with the wall standing, against the ${empty} the empty ` +
      `yard read`,
  );

  const cleared = await captureReplay(h, "shorten", async () => {
    await h.advance(6);
    for (const id of standing) h.debug.dismantle(id);
    await h.advance(6);
    return h.snapshot();
  });

  assertLength(
    cleared.structures,
    0,
    "the structures left once every one of them was dismantled",
  );
  assertCloseTo(
    cleared.mazeLength,
    empty,
    6,
    `the maze length once the wall is dismantled and its tiles are Open again, ` +
      `against the ${empty} the same yard read before it was built`,
  );
});

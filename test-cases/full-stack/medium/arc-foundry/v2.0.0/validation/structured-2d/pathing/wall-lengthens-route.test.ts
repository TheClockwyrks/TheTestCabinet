// pathing/wall-lengthens-route — every structure is a wall, so building across a
// leg lengthens the route the Load walks.
//
// THIS IS THE GAME. `specs/pathing.md` gives the yard no fixed track: the player
// scores by making the Load walk further past the components, and the maze length
// is the reading that says how well that is going. A build whose structures do
// not block pathing has a tower-defence game with no maze in it, and every other
// pathing point in this project is measuring something that never mattered.
//
// BOTH HALVES ARE READ, because a build can move the number without moving the
// units. The figure rises when the wall lands, and the unit released afterwards
// is watched across the wall's own columns and is never on one of its tiles.

import { afterEach, beforeEach, it } from "vitest";
import { FOOTPRINT, type Point, TILE, tileCenter } from "../constants";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  releaseUnit,
  standCandidate,
  unitById,
} from "../harness";

/** The wall: three footprints stacked across the Entry -> WP1 leg at row 5. */
const WALL_COL = 20;
const WALL_ROWS = [2, 4, 6];

/** The speed the walk is watched at, and how far past the wall it runs. */
const WALK_SPEED = 4;
const PAST_X = TILE * (WALL_COL + FOOTPRINT) + 2 * TILE;
const WALK_FRAMES = 900;

/** Whether a point lies inside the wall's own tiles. */
function insideWall(x: number, y: number): boolean {
  const left = TILE * WALL_COL;
  const right = TILE * (WALL_COL + FOOTPRINT);
  if (x < left || x > right) return false;
  return WALL_ROWS.some((row) => {
    const top = tileCenter(WALL_COL, row).y - TILE / 2;
    return y >= top && y <= top + TILE * FOOTPRINT;
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the maze length, and the Load walks around what was built", async () => {
  openYard(h, { wave: 1 });
  const empty = h.snapshot().mazeLength;

  // A wall of rocks dropped through the real press, across the leg the Load
  // walks first.
  for (const row of WALL_ROWS) {
    standCandidate(h, "capacitor", 1, WALL_COL, row);
  }
  const walled = h.snapshot().mazeLength;
  assertGreaterThan(
    walled,
    empty,
    `the maze length once ${WALL_ROWS.length} footprints stand across the ` +
      `Entry -> WP1 leg at column ${WALL_COL}; the empty yard read ${empty}`,
  );

  // And a unit released afterwards walks the new route rather than the old one.
  const walk = await captureReplay(h, "reroute", async () => {
    h.debug.setSpeed(WALK_SPEED);
    const id = releaseUnit(h, "spark");
    const trodden: Point[] = [];
    let past = false;
    for (let frame = 0; frame < WALK_FRAMES && !past; frame += 1) {
      await h.advance(1);
      const unit = unitById(h.snapshot(), id);
      trodden.push({ x: unit.x, y: unit.y });
      past = unit.x > PAST_X;
    }
    return { trodden, past };
  });

  assertTrue(
    walk.past,
    `the released unit to have walked past column ` +
      `${WALL_COL + FOOTPRINT} within ${WALK_FRAMES} frames, so the route it ` +
      `took is the one that was watched`,
  );
  const through = walk.trodden.find((at) => insideWall(at.x, at.y));
  assertTrue(
    through === undefined,
    `the unit never to stand on a walled tile: columns ${WALL_COL}-` +
      `${WALL_COL + FOOTPRINT - 1} at rows ` +
      WALL_ROWS.map((row) => `${row}-${row + FOOTPRINT - 1}`).join(", "),
  );
});

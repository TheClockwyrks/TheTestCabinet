// yard-drawing/maze-route-on-hover — hovering the maze length draws the route.
//
// `specs/hud.md`: the maze-length read is hovered to draw "the full ground route
// on the yard, from the entry through every waypoint to the collector", and
// `specs/controls.md` lists the pointer act: "move over the maze-length readout —
// draws the full ground route on the yard".
//
// WHERE THE READOUT IS. The build's own choice, and the build reports it:
// `statusReadouts` returns the bar's reads by name with the rectangle each was
// drawn at, and "a pointer standing at its center is over it"
// (`specs/instrumentation.md`). So the pointer is moved to the center of the
// rectangle the build reported for `maze-length`, and a build that draws the read
// on two lines, off the bar's midline, or narrow is hovered exactly as one that
// draws it wide and centred.
//
// WHAT COUNTS AS THE ROUTE BEING DRAWN. The yard itself, at the tile centers the
// route runs through. On an empty Substation the first leg is the only route
// there is between the entry at `(0, 5)` and `WP1` at `(44, 5)`: straight along
// row `5`, `44` tiles, where every other way round is longer by at least two
// diagonal steps. So those tile centers are where a drawn ground route has to
// pass, and they are read with the pointer off the bar, on the readout, and off
// it again — because a route that appears and never leaves is not a hover.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  DISTINCT,
  type Harness,
  hoverReadout,
  openYard,
  rgbDistance,
  sample,
} from "../harness";
import { mapById, tileCenter } from "../constants";

const MAP = "substation";
/** Somewhere on the open yard, well clear of the chain and of the bar. */
const OFF = { x: 500, y: 400 };
/** How many of the route's tile centers a drawn route has to reach. */
const ENOUGH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ground route while the pointer is over the maze readout", async () => {
  const map = mapById(MAP);
  await openYard(h, { map: MAP });

  // The first leg's route: straight along the entry's row, which is the only
  // shortest way across an empty yard.
  const first = map.waypoints[0]!;
  const along: { x: number; y: number }[] = [];
  for (let col = map.entry.col + 4; col < first.col - 4; col += 2) {
    along.push(tileCenter(col, map.entry.row));
  }
  assertGreaterThan(
    along.length,
    ENOUGH,
    "how many tile centers the leg gives",
  );

  await h.debug.pointerMove(OFF.x, OFF.y);
  const bare = await sample(h, along);

  const moved = async (): Promise<number> => {
    const now = await sample(h, along);
    return now.filter((p, i) => rgbDistance(p, bare[i]!) > DISTINCT).length;
  };

  const read = await hoverReadout(h, "maze-length");
  await captureStill(h, "route");
  assertGreaterThanOrEqual(
    await moved(),
    ENOUGH,
    "how many of the first leg's tile centers the yard drew over while the " +
      `pointer stood at the center of the maze-length read the build reported ` +
      `at ${read.x}, ${read.y}, ${read.w} by ${read.h}`,
  );

  await h.debug.pointerMove(OFF.x, OFF.y);
  assertEqual(
    await moved(),
    0,
    "how many of the first leg's tile centers are still drawn over once the " +
      "pointer has left the readout",
  );
});

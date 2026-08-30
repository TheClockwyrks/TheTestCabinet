// yard-drawing/maze-route-on-hover — hovering the maze length draws the route.
//
// `specs/hud.md`: the maze-length read is hovered to draw "the full ground route
// on the yard, from the entry through every waypoint to the collector", and
// `specs/controls.md` lists the pointer act: "move over the maze-length readout —
// draws the full ground route on the yard".
//
// WHERE THE READOUT IS. No reading reports it: `statusControls` carries the bar's
// five controls and the maze length is a read rather than a control. What
// `specs/hud.md` does fix is the bar's order left to right — Charge, Grid
// Integrity, wave, maze length, then the combos toggle — so the readout is
// somewhere in the strip left of that toggle, whose rectangle `statusControls`
// does report. The strip is therefore swept, and the pointer position that draws
// the route is found rather than assumed.
//
// WHAT COUNTS AS THE ROUTE BEING DRAWN. The yard itself, at the tile centers the
// route runs through. On an empty Substation the first leg is the only route
// there is between the entry at `(0, 5)` and `WP1` at `(44, 5)`: straight along
// row `5`, `44` tiles, where every other way round is longer by at least two
// diagonal steps. So those tile centers are where a drawn ground route has to
// pass, and they are read with the pointer off the bar, swept across it, and off
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
  openYard,
  statusControl,
  type Harness,
} from "../harness";
import { BAR_H, mapById, tileCenter } from "../constants";
import { DISTINCT, rgbDistance, sample } from "./reading";

const MAP = "substation";
/** Somewhere on the open yard, well clear of the chain and of the bar. */
const OFF = { x: 500, y: 400 };
/** How finely the strip left of the combos toggle is swept. */
const SWEEP_STEP = 12;
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

  const combos = await statusControl(h, "combos");
  let best = 0;
  let bestX = 0;
  for (let x = SWEEP_STEP; x < combos.x; x += SWEEP_STEP) {
    await h.debug.pointerMove(x, BAR_H / 2);
    const count = await moved();
    if (count > best) {
      best = count;
      bestX = x;
    }
  }

  await h.debug.pointerMove(bestX, BAR_H / 2);
  await captureStill(h, "route");
  assertGreaterThanOrEqual(
    best,
    ENOUGH,
    "how many of the first leg's tile centers the yard drew over while the " +
      `pointer swept the bar left of the combos toggle, at ${SWEEP_STEP}-unit ` +
      "steps",
  );

  await h.debug.pointerMove(OFF.x, OFF.y);
  assertEqual(
    await moved(),
    0,
    "how many of the first leg's tile centers are still drawn over once the " +
      "pointer has left the bar",
  );
});

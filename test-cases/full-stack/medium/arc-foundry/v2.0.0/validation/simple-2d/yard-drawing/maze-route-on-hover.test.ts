// yard-drawing/maze-route-on-hover — hovering the maze length draws the route.
//
// `specs/hud.md`: the maze-length read is hovered to draw "the full ground route
// on the yard, from the entry through every waypoint to the collector", and
// `specs/controls.md` lists the pointer act: "move over the maze-length readout —
// draws the full ground route on the yard".
//
// WHERE THE READOUT IS. The build says. `specs/hud.md` fixes the bar's reads and
// their left-to-right order and leaves every rectangle to the build, so
// `specs/instrumentation.md` has the build report each read's own rectangle through
// `statusReadouts`, with the same guarantee a control's rectangle carries: it is
// where the read is drawn, so a pointer standing at its centre is over it. The
// pointer is put there and nowhere else, so a conformant build that draws the read
// on two lines, off the bar's midline, or narrower than any step a search would
// take is hovered exactly as a player hovers it.
//
// WHAT COUNTS AS THE ROUTE BEING DRAWN. The yard itself, at the tile centers the
// route runs through. On an empty Substation the first leg is the only route
// there is between the entry at `(0, 5)` and `WP1` at `(44, 5)`: straight along
// row `5`, `44` tiles, where every other way round is longer by at least two
// diagonal steps. So those tile centers are where a drawn ground route has to
// pass, and they are read with the pointer on the readout and with it off, because
// a route that appears and never leaves is not a hover.
//
// THE POINTER IS THE ENGINE'S. `specs/instrumentation.md` puts no pointer
// operation on the surface under an engine, so a hover is a real pointer event
// dispatched at the engine's own surface. A position is a LEVEL rather than an
// edge, so it stands until it is moved again, and the game reads it inside the
// next `update` — which is the frame `sample` runs before it reads the canvas.
//
// EVERY COMPARISON IS BETWEEN NEIGHBOURING FRAMES. Nothing forbids a build from
// animating its yard, and `specs/hud.md` does not, so a reading held against a
// frame drawn seconds earlier would measure the animation rather than the hover.
// Each pair compared here is one frame apart, which is short enough that anything
// the yard does on its own is the same in both and the only difference left is
// where the pointer was.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  DISTINCT,
  type Harness,
  openYard,
  rgbDistance,
  sample,
  statusReadout,
} from "../harness";
import { mapById, tileCenter } from "../constants";

const MAP = "substation";
/** Somewhere on the open yard, well clear of the chain and of the bar. */
const OFF = { x: 500, y: 400 };
/** How many of the route's tile centers a drawn route has to reach. */
const ENOUGH = 3;

type Pixel = [number, number, number, number];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How many of two samplings of the same points read as told apart. */
function moved(a: readonly Pixel[], b: readonly Pixel[]): number {
  return a.filter((p, i) => rgbDistance(p, b[i]!) > DISTINCT).length;
}

it("draws the ground route while the pointer is over the maze readout", async () => {
  const map = mapById(MAP);
  openYard(h, { map: MAP });

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

  // The read's own rectangle, as the build reported it.
  const readout = statusReadout(h, "maze-length");
  assertGreaterThan(
    readout.w * readout.h,
    0,
    "the area of the rectangle the build reports for its maze-length read " +
      "(specs/instrumentation.md)",
  );
  const over = controlCenter(readout);

  /** One frame with the pointer on the readout, or off it entirely. */
  const readAt = (at: { x: number; y: number } | null): Promise<Pixel[]> => {
    const point = at ?? OFF;
    h.pointerMove(point.x, point.y);
    return sample(h, along);
  };

  // The route appears with the pointer and leaves with it: three consecutive
  // frames, off the readout, on it, off it again.
  const before = await readAt(null);
  const hovered = await readAt(over);
  captureStill(h, "route");
  const after = await readAt(null);

  assertGreaterThanOrEqual(
    moved(hovered, before),
    ENOUGH,
    "how many of the first leg's tile centers the yard draws over with the " +
      `pointer at the centre of the reported maze-length rectangle ` +
      `(${over.x}, ${over.y})`,
  );
  assertEqual(
    moved(after, before),
    0,
    "how many of the first leg's tile centers are still drawn over once the " +
      "pointer has left the readout",
  );
});

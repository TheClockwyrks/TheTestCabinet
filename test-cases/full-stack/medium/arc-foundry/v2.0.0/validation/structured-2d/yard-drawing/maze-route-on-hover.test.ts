// yard-drawing/maze-route-on-hover — hovering the maze length draws the route.
//
// `specs/hud.md`: the maze-length read is hovered to draw "the full ground route
// on the yard, from the entry through every waypoint to the collector", and
// `specs/controls.md` lists the pointer act: "move over the maze-length readout —
// draws the full ground route on the yard".
//
// WHERE THE READOUT IS. The build says. `specs/hud.md` fixes the bar's reads and
// their left-to-right order and leaves each one's rectangle to the build, so
// `specs/instrumentation.md` carries `statusReadouts`, which reports every read
// the bar drew by name and by rectangle — and gives the rectangle the same
// guarantee the control readings carry: it is where the read is drawn, so a
// pointer standing at its center is over it. The pointer therefore goes to the
// center of the `maze-length` rectangle the build reported, and a build that drew
// the read on two lines, off the bar's midline, or narrow is hovered exactly as
// one that drew it wide and centred.
//
// WHAT COUNTS AS THE ROUTE BEING DRAWN. The yard itself, at the tile centers the
// route runs through. On an empty Substation the first leg is the only route
// there is between the entry at `(0, 5)` and `WP1` at `(44, 5)`: straight along
// row `5`, `44` tiles, where every other way round is longer by at least two
// diagonal steps. So those tile centers are where a drawn ground route has to
// pass, and they are read with the pointer on the read and with it off, because a
// route that appears and never leaves is not a hover.
//
// AND WHAT COUNTS AS DRAWN OVER. `DRAWN`, the floor below which a sampling cannot
// tell a drawing from the host's own rounding — or how far those same centers
// travel on their own with the pointer nowhere near the bar, whichever is
// further. Nothing here reads what the route looks like: a line, a dotted trail,
// a tinted lane and a row of chevrons all clear it.
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
  DRAWN,
  type Harness,
  idleSpread,
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
/**
 * How many frames the route's tile centers are watched over, pointer off.
 *
 * Two seconds of them, which outlasts a full turn of any plausible idle pulse.
 * `specs/hud.md` fixes what the yard draws and nothing that forbids a build from
 * breathing it, so a point counts as drawn over only once it moves further than
 * the ground moves unasked.
 */
const IDLE_MOMENTS = 120;

type Pixel = [number, number, number, number];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How many of two samplings of the same points read as drawn over. */
function moved(
  a: readonly Pixel[],
  b: readonly Pixel[],
  floor: number,
): number {
  return a.filter((p, i) => rgbDistance(p, b[i]!) > floor).length;
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

  const readout = controlCenter(statusReadout(h, "maze-length"));

  /** One frame with the pointer on the reported read, or off the bar entirely. */
  const readAt = (on: boolean): Promise<Pixel[]> => {
    if (on) h.pointerMove(readout.x, readout.y);
    else h.pointerMove(OFF.x, OFF.y);
    return sample(h, along);
  };

  // How far those tile centers travel on their own, with the pointer nowhere
  // near the bar: the control the two readings below are held against.
  h.pointerMove(OFF.x, OFF.y);
  const floor = Math.max(DRAWN, await idleSpread(h, along, IDLE_MOMENTS));

  // The route appears with the pointer and leaves with it: three consecutive
  // frames, off the bar, on the read, off the bar again.
  const before = await readAt(false);
  const hovered = await readAt(true);
  captureStill(h, "route");
  const after = await readAt(false);

  assertGreaterThanOrEqual(
    moved(hovered, before, floor),
    ENOUGH,
    "how many of the first leg's tile centers the yard draws over with the " +
      "pointer at the center of the rectangle statusReadouts reports for the " +
      "maze-length read",
  );
  assertEqual(
    moved(after, before, floor),
    0,
    "how many of the first leg's tile centers are still drawn over once the " +
      "pointer has left the read",
  );
});

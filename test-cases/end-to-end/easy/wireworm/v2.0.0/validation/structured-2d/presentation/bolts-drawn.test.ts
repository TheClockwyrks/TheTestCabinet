// Wireworm — presentation/bolts-drawn: a bolt in flight is drawn in its column.
//
// specs/overview.md's legibility table: "A bolt reads apart from the board along
// the column it is climbing." specs/assets.md seeds no art for a bolt and puts
// it among the things "drawn in code", and specs/cursor.md fixes where it is:
// its centre climbs its column at `BOLT_SPEED` (`900`) units per second, and the
// snapshot reports that centre. So the two halves of the reading are WHERE the
// bolt is drawn and WHETHER it reads apart from the board.
//
// THE READING IS THE PIXELS AROUND THE CENTRE THE BUILD ITSELF REPORTS. Within
// half a tile of it, something must be drawn that no bare tile of the same board
// carries: the pixel there that sits furthest from the board's own colour must
// sit more than `DISTINCT_MIN` of 441 away from it. A bolt drawn as a hairline,
// a dart or a glowing streak all satisfy that, since it is the pixels a build
// put down rather than the shape it drew them in; a bolt drawn somewhere else,
// or in the colour of the board it crosses, does not.
//
// THE HALF-TILE IS THE ITEM'S OWN LATITUDE. Where inside its own tile a build
// centres the mark is the build's; that it is drawn where the game says the bolt
// IS is the specification's.
//
// THE BOARD IS EMPTY, so the bolt resolves against nothing while the frame is
// read (specs/cursor.md gives it a worm segment, a node or a foe to strike, and
// there is none), and the board's own colour is read from a bare tile of the row
// the bolt is climbing through.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE, tileCX, tileCY } from "../../src/constants";
import { assertDefined, assertGreaterThan } from "../assert";
import {
  boltById,
  captureStill,
  colorDistance,
  createHarness,
  poseBolt,
  resetTo,
  sampleTile,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far the drawn bolt must sit from the board's own colour, as a Euclidean
 * RGB distance out of the `441` an RGB cube is across. The case's figure, since
 * the specification states the rule and leaves the palette to the build.
 */
const DISTINCT_MIN = 40;

/** How far from the reported centre the bolt may be drawn: half a tile. */
const PLACED_MAX = TILE / 2;

/** The tile the bolt is posed climbing through, and a bare tile of that row. */
const BOLT_COLUMN = 20;
const BOLT_ROW = 12;
const BARE_COLUMN = 34;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The pixel within `PLACED_MAX` of `(x, y)` furthest from `board`. */
function furthestFromBoard(
  x: number,
  y: number,
  board: Rgb,
): { distance: number; dx: number; dy: number } {
  let found = { distance: -1, dx: 0, dy: 0 };
  for (let dy = -PLACED_MAX; dy <= PLACED_MAX; dy += 1) {
    for (let dx = -PLACED_MAX; dx <= PLACED_MAX; dx += 1) {
      const [r, g, b] = h.pixel(x + dx, y + dy);
      const distance = colorDistance({ r, g, b }, board);
      if (distance > found.distance) found = { distance, dx, dy };
    }
  }
  return found;
}

it("draws a bolt at the centre it reports, apart from the board", async () => {
  resetTo(h);
  startPlaying(h);
  poseBolt(h, tileCX(BOLT_COLUMN), tileCY(BOLT_ROW));

  const posed = h.snapshot().bolts;
  assertGreaterThan(posed.length, 0, "the posed bolt is in flight");
  const id = posed[posed.length - 1].id;

  await h.advance(1);
  // The bolt drawn in its column, one frame into its climb.
  captureStill(h, "bolt");

  const bolt = boltById(h.snapshot(), id);
  assertDefined(
    bolt,
    `the posed bolt still in flight one frame on, climbing its column at ` +
      `BOLT_SPEED (${BOLT_SPEED}) over an empty board with nothing to strike ` +
      `(specs/cursor.md)`,
  );

  const board = sampleTile(h, BARE_COLUMN, BOLT_ROW);
  const drawn = furthestFromBoard(bolt?.x ?? 0, bolt?.y ?? 0, board);
  assertGreaterThan(
    drawn.distance,
    DISTINCT_MIN,
    `the bolt drawn within ${PLACED_MAX} units of the centre the snapshot ` +
      `reports it at, (${bolt?.x}, ${bolt?.y}), in pixels more than ` +
      `${DISTINCT_MIN} of 441 from the board's own colour ` +
      `(specs/overview.md: a bolt reads apart from the board along the column ` +
      `it is climbing); the bare tile at (${BARE_COLUMN}, ${BOLT_ROW}) ` +
      `sampled rgb(${board.r.toFixed(0)}, ${board.g.toFixed(0)}, ` +
      `${board.b.toFixed(0)})`,
  );
});

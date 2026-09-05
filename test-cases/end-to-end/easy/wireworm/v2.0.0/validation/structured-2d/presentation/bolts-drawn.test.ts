// Wireworm — presentation/bolts-drawn: a bolt in flight is drawn in its column.
//
// specs/overview.md's legibility table: "A bolt reads apart from the board along
// the column it is climbing." specs/assets.md seeds no art for a bolt and puts
// it among the things "drawn in code", and specs/cursor.md fixes where it is:
// its centre climbs its column at `BOLT_SPEED` (`900`) units per second, and the
// snapshot reports that centre. So what is read is WHERE the bolt is drawn.
//
// THE READING IS THE SAME BOX OF THE BOARD, WITH THE BOLT AND WITHOUT IT.
// Within half a tile of the centre the build itself reports, some pixel must
// MOVE AT ALL when the bolt is taken off the board — which is to say the bolt
// put something there that the board does not carry on its own. A bolt drawn as
// a hairline, a dart or a glowing streak all satisfy that, since it is the
// pixels a build put down rather than the shape it drew them in; a bolt drawn
// somewhere else does not.
//
// WHY THE CONTROL IS THE SAME BOX RATHER THAN A BARE TILE ELSEWHERE.
// specs/overview.md fixes no palette and leaves the board's look entirely to the
// build, so a build is free to rule, shade or texture its ground — and a box
// held against some other tile's colour would read that build's own trace as a
// bolt. Held against itself, the only thing that can move is what the bolt drew.
//
// NO FIGURE IS ASSERTED. `getImageData` returns the bytes that are there, so a
// box the bolt drew nothing into comes back byte-identical to itself and
// measures exactly `0`. How brightly the bolt reads against the board is
// appearance, and the reviewer's from the captured still.
//
// THE HALF-TILE IS THE ITEM'S OWN LATITUDE. Where inside its own tile a build
// centres the mark is the build's; that it is drawn where the game says the bolt
// IS is the specification's.
//
// THE BOARD IS EMPTY, so the bolt resolves against nothing while the frame is
// read (specs/cursor.md gives it a worm segment, a node or a foe to strike, and
// there is none), and taking it off with `clearBolts` leaves the same empty
// board behind.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE, tileCX, tileCY } from "../constants";
import { assertDefined, assertGreaterThan, assertLength } from "../assert";
import {
  boltById,
  captureStill,
  createHarness,
  poseBolt,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";

/** How far from the reported centre the bolt may be drawn: half a tile. */
const PLACED_MAX = TILE / 2;

/** The tile the bolt is posed climbing through. */
const BOLT_COLUMN = 20;
const BOLT_ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every device pixel of the square of `half` logical units about `(x, y)`. */
function readBox(x: number, y: number, half: number): Uint8ClampedArray {
  const from = h.device(x - half, y - half);
  const to = h.device(x + half, y + half);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

/** How far the furthest pixel of one reading moved against the other. */
function furthestMove(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let furthest = 0;
  const length = Math.min(before.length, after.length);
  for (let at = 0; at + 2 < length; at += 4) {
    const moved = Math.hypot(
      after[at] - before[at],
      after[at + 1] - before[at + 1],
      after[at + 2] - before[at + 2],
    );
    if (moved > furthest) furthest = moved;
  }
  return furthest;
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
  if (bolt === undefined) return;

  const drawn = readBox(bolt.x, bolt.y, PLACED_MAX);

  // The same box of the same board with the bolt taken off it: the control
  // every pixel of the reading above is held against.
  h.debug.clearBolts();
  await h.advance(1);
  assertLength(h.snapshot().bolts, 0, "the board is left with no bolt");
  const bare = readBox(bolt.x, bolt.y, PLACED_MAX);

  assertGreaterThan(
    furthestMove(bare, drawn),
    0,
    `the bolt drawn within ${PLACED_MAX} units of the centre the snapshot ` +
      `reports it at, (${bolt.x.toFixed(1)}, ${bolt.y.toFixed(1)}), in pixels ` +
      `that differ from what that same box of the board carries with no bolt ` +
      `on it (specs/overview.md: a bolt reads apart from the board along the ` +
      `column it is climbing)`,
  );
});

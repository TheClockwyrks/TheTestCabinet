// Wireworm — presentation/bolts-drawn: a bolt in flight is drawn in its column.
//
// specs/overview.md's legibility table: "A bolt reads apart from the board along
// the column it is climbing." specs/assets.md seeds no art for a bolt and puts
// it among the things "drawn in code", and specs/cursor.md fixes where it is:
// its centre climbs its column at `BOLT_SPEED` (`900`) units per second, and the
// snapshot reports that centre. So what is read is WHERE the bolt is drawn.
//
// THE READING IS THE SAME DISC OF THE BOARD, WITH THE BOLT AND WITHOUT IT.
// Within half a tile of the centre the build itself reports, some pixel must
// MOVE AT ALL when the bolt is taken off the board — which is to say the bolt
// put something there that the board does not carry on its own. A bolt drawn as
// a hairline, a dart or a glowing streak all satisfy that, since it is the
// pixels a build put down rather than the shape it drew them in; a bolt drawn
// somewhere else does not.
//
// NO FIGURE IS ASSERTED. `getImageData` returns the bytes that are there, so a
// disc the bolt drew nothing into comes back byte-identical to itself and
// measures exactly `0`. How brightly the bolt reads against the board is
// appearance, and the reviewer's from the captured still.
//
// WHY THE CONTROL IS THE SAME DISC RATHER THAN A BARE TILE ELSEWHERE.
// specs/overview.md fixes no palette and leaves the board's look entirely to the
// build, so a build is free to rule, shade or texture its ground — and a disc
// held against some other tile's colour would read that build's own trace as a
// bolt. Held against itself, the only thing that can move is what the bolt drew.
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
import { assertDefined, assertGreaterThan, assertLength } from "../assert";
import { BOLT_SPEED, TILE } from "../constants";
import {
  boltById,
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  type Harness,
} from "../harness";
import { furthestChange, readDisc } from "./reading";

/** How far from the reported centre the bolt may be drawn: half a tile. */
const PLACED_MAX = TILE / 2;

/** The tile the bolt is posed climbing through. */
const BOLT_COLUMN = 20;
const BOLT_ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a bolt at the centre it reports, apart from the board", async () => {
  await startPlaying(h);
  const id = await poseBolt(h, BOLT_COLUMN, BOLT_ROW);

  await h.advance(1);
  // The bolt drawn in its column, one frame into its climb.
  await captureStill(h, "bolt");

  const bolt = boltById(await h.snapshot(), id);
  assertDefined(
    bolt,
    `the posed bolt still in flight one frame on, climbing its column at ` +
      `BOLT_SPEED (${BOLT_SPEED}) over an empty board with nothing to strike ` +
      `(specs/cursor.md)`,
  );
  if (bolt === undefined) return;

  const drawn = await readDisc(h, bolt.x, bolt.y, PLACED_MAX);

  // The same disc of the same board with the bolt taken off it: the control
  // every pixel of the reading above is held against.
  await h.debug.clearBolts();
  await h.advance(1);
  assertLength((await h.snapshot()).bolts, 0, "the board is left with no bolt");
  const bare = await readDisc(h, bolt.x, bolt.y, PLACED_MAX);

  const moved = furthestChange(bare, drawn, bolt.x, bolt.y, PLACED_MAX);
  assertGreaterThan(
    moved.distance,
    0,
    `the bolt drawn within ${PLACED_MAX} units of the centre the snapshot ` +
      `reports it at, (${bolt.x.toFixed(1)}, ${bolt.y.toFixed(1)}), in pixels ` +
      `that differ from what that same disc of the board carries with no bolt ` +
      `on it (specs/overview.md: a bolt reads apart from the board along the ` +
      `column it is climbing); the pixel that moved furthest was at ` +
      `(${moved.x.toFixed(0)}, ${moved.y.toFixed(0)})`,
  );
});

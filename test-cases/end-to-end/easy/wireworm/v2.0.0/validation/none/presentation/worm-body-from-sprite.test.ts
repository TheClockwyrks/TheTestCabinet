// Wireworm — presentation/worm-body-from-sprite: a middle segment is drawn from
// its own pair of seeded frames.
//
// specs/assets.md seeds `assets/worm/` with `WORM_FRAMES` (`6`) frames — "a
// two-frame pair for each of the three parts of a chain" — and tabulates which
// pair is drawn on which segment: frames `0` and `1` on the head, `2` and `3` on
// every segment between the head and the tail, `4` and `5` on the trailing
// segment. Each pair alternates at its own rate while the worm is on the board.
// specs/overview.md's legibility table asks that the head, the body and the tail
// be told apart, and drawing each from its own pair is how the seeded art does
// it: a build that drew one frame for every segment shows a chain with no ends.
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. The
// bitmaps blitted on the segment's tile are captured with the sources they were
// handed, and each source is held against the seeded PNGs read off the same
// `assets/` tree the build was seeded with. A source that IS a seeded frame
// matches it exactly, so the reading names the frame the build reached for.
//
// THE POSE IS THE SHORTEST WORM THAT HAS ONE OF EACH PART: three segments, laid
// along one row with the head at the right-hand end, heading right so no frame
// is mirrored (specs/assets.md mirrors a leftward worm, which
// presentation/worm-mirrored decides). Its step is off, so it holds the tiles it
// was laid on and the frame read is the frame drawn on a segment between the head and the tail. Nothing
// else is on the board.
//
// EITHER FRAME OF THE PAIR SATISFIES IT. The pair alternates on the build's own
// clock, so which of the two is up on the frame this check reads is the build's
// business; what the specification fixes is that it comes from THIS pair.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TILE, tileCX, tileCY, WORM_BODY_FRAMES } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  frameIndexes,
  poseWorm,
  startPlaying,
  wormById,
  type Harness,
} from "../harness";
import { blitsNear, describeBlits } from "./reading";

/**
 * How far a blit's centre may sit from the tile it is drawn on, in logical
 * units.
 *
 * Half a tile. specs/board.md draws a worm segment "centered on" its tile's
 * centre, and how a build inks the frame inside that tile is its own; a blit
 * whose centre left the tile altogether is drawn on a different tile.
 */
const PLACED_MAX = TILE / 2;

/** The worm: three segments along one mid-board row, head at the right. */
const HEAD_COLUMN = 10;
const WORM_ROW = 6;
const WORM_LENGTH = 3;

/** Which segment of that worm this point reads. `0` is the head. */
const SEGMENT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blits a body frame of the seeded worm art on the body's tile", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, {
    c: HEAD_COLUMN,
    r: WORM_ROW,
    length: WORM_LENGTH,
    stepping: false,
  });

  const blits = await blitsOfFrame(h);
  // The posed worm, drawn from the seeded art.
  await captureStill(h, "body");

  const posed = wormById(await h.snapshot(), id);
  assertEqual(
    posed?.segments.length,
    WORM_LENGTH,
    "the worm posed holds three segments, so it has a head, a body and a tail",
  );
  if (posed === undefined) fail("a worm on the board", "the roster was empty");

  const segment = posed.segments[SEGMENT];
  const at = { x: tileCX(segment.c), y: tileCY(segment.r) };
  const fromSheet = drawnFrom(blits, "worm", at, PLACED_MAX);
  const drawn = frameIndexes(fromSheet, "worm").filter((index) =>
    WORM_BODY_FRAMES.includes(index),
  );
  if (drawn.length > 0) return;
  fail(
    `the body, on tile (${segment.c}, ${segment.r}), to be drawn from ` +
      `frame 2 or 3 of assets/worm/, blitted within ${PLACED_MAX} units of ` +
      `its tile centre (specs/assets.md: a segment between the head and the tail is drawn from that pair)`,
    describeBlits(blitsNear(blits, at, PLACED_MAX)),
  );
});

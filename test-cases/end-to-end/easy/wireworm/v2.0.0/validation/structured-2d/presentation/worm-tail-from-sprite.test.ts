// Wireworm — presentation/worm-tail-from-sprite: the tail is drawn from its
// own pair of seeded frames.
//
// specs/assets.md seeds `assets/worm/` with `WORM_FRAMES` (`6`) frames — "a
// two-frame pair for each of the three parts of a chain" — and tabulates which
// pair is drawn on which segment: frames `0` and `1` on the head, `2` and `3`
// on every segment between the head and the tail, `4` and `5` on the trailing
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
// was laid on and the frame read is the frame drawn on the segment this point
// names. Nothing else is on the board.
//
// EITHER FRAME OF THE PAIR SATISFIES IT. The pair alternates on the build's own
// clock, so which of the two is up on the frame this check reads is the build's
// business; what the specification fixes is that it comes from THIS pair.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  nearestSeededFrame,
  poseWorm,
  resetTo,
  startPlaying,
  tileCenter,
  wormById,
  type Harness,
} from "../harness";

/**
 * How far a blitted source may sit from a seeded frame and still BE it: the
 * mean absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is identity, so this is not a likeness tolerance. It is room
 * for the one lossy step in reading a bitmap back out of a canvas — a partially
 * transparent pixel is premultiplied on the way in and un-premultiplied on the
 * way out, so it can shift by a unit. Two different frames of `assets/worm/`
 * measure far more than this against each other.
 */
const MATCH_MAX = 1;

/** How far a blit's centre may sit from the tile it is drawn on: half a tile. */
const PLACED_MAX = TILE / 2;

/** The frames specs/assets.md draws the tail from. */
const TAIL_FRAMES = [4, 5] as const;

/** The worm: three segments along one mid-board row, head at the right. */
const HEAD_COLUMN = 10;
const WORM_ROW = 6;
const WORM_LENGTH = 3;

/** Which segment of that worm this point reads. `0` is the head. */
const SEGMENT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits a tail frame of the seeded worm art on the tail's tile", async () => {
  resetTo(h);
  startPlaying(h);
  const worm = poseWorm(h, HEAD_COLUMN, WORM_ROW, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);
  // The posed worm, drawn from the seeded art.
  captureStill(h, "tail");

  const posed = wormById(h.snapshot(), worm);
  assertEqual(
    posed?.segments.length,
    WORM_LENGTH,
    "the worm posed holds three segments, so it has a head, a body and a tail",
  );
  assertEqual(h.assetFailures.length, 0, "every seeded frame loaded");

  const segment = posed?.segments[SEGMENT];
  if (segment === undefined) fail("a tail segment on the board", posed);
  const centre = tileCenter(segment.c, segment.r);
  const near = blits.filter(
    (blit) => Math.hypot(blit.x - centre.x, blit.y - centre.y) <= PLACED_MAX,
  );
  const matches = await Promise.all(
    near.map((blit) => nearestSeededFrame(blit.source)),
  );
  const drawn = matches.find(
    (match) =>
      match.folder === "worm" &&
      match.distance <= MATCH_MAX &&
      (TAIL_FRAMES as readonly number[]).includes(match.index),
  );
  if (drawn !== undefined) return;
  fail(
    `the tail, on tile (${segment.c}, ${segment.r}), to be drawn from ` +
      `frame ${TAIL_FRAMES[0]} or ${TAIL_FRAMES[1]} of assets/worm/, blitted ` +
      `within ${PLACED_MAX} units of its tile centre (specs/assets.md: ` +
      `frames 4 and 5 are the tail, drawn on the ` +
      `trailing segment)`,
    near.length === 0
      ? "no bitmap was blitted on that tile"
      : matches
          .map(
            (match) =>
              `${match.folder}/${match.index} at ${match.distance.toFixed(2)}`,
          )
          .join(", "),
  );
});

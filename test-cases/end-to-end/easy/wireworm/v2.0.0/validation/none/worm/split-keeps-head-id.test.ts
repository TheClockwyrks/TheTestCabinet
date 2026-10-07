// worm/split-keeps-head-id — the head-side piece keeps the worm's id and the
// trailing piece takes a fresh one.
//
// specs/worm.md, "Cutting the worm": "The first surviving run, counted from the
// head end, keeps the worm's id, its two headings, and its diving flag ... Each
// further run becomes a new worm, taking a fresh id". specs/instrumentation.md
// leans on the same rule under Identity, because it is what lets a caller keep
// hold of an entity across a cut.
//
// WHAT IS READ. Two identities, and nothing else: the id the head-side piece
// reports, against the id the worm carried before the shot; and the id the
// trailing piece reports, against that same id. How the pieces are SHAPED — two
// runs of three, at the tiles the cut left them on — is
// `worm.shot-middle-splits`'s requirement, so the pieces are found by the tiles
// they stand on rather than by the ids under test, and their lengths are not
// asserted here.
//
// THE WORLD THIS POSES is the same seven-segment worm cut at its fourth segment:
// an empty, quiet board, a clear row, one bolt in the fourth segment's column, and
// the worm's `stepping` held off so the chain the bolt arrives at is the chain
// that was posed.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertNotEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseBolt,
  poseWorm,
  segmentTiles,
  startPlaying,
  type Harness,
  type WirewormSnapshot,
  type WormView,
} from "../harness";

/** The worm posed: seven segments, head at (20, 5), tail at column 14. */
const LENGTH = 7;
const HEAD_C = 20;
const ROW = 5;
const TAIL_C = HEAD_C - (LENGTH - 1);

/** The segment the bolt is aimed at: the fourth, counted from the head. */
const CUT_C = HEAD_C - 3;

/** Where the bolt starts: the fourth segment's column, seven rows below it. */
const BOLT_R = ROW + 7;

/**
 * How long the bolt may take to arrive, in frames: twice the `0.249` s that seven
 * tiles of `TILE` (`32`) units take at `BOLT_SPEED` (`900` units per second). A
 * bound on a bolt that never resolved, not a tolerance.
 */
const BOLT_TIMEOUT = framesFor(((BOLT_R - ROW) * TILE * 2) / BOLT_SPEED);

/** The worm with a segment on that tile, or `undefined`. */
function wormOn(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): WormView | undefined {
  return snapshot.worms.find((worm) =>
    worm.segments.some((tile) => tile.c === c && tile.r === r),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps the worm's id on the head-side piece and freshens the other", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, {
    c: HEAD_C,
    r: ROW,
    length: LENGTH,
    stepping: false,
  });

  await poseBolt(h, CUT_C, BOLT_R);
  const swept = await h.until((s) => segmentTiles(s).length < LENGTH, {
    maxFrames: BOLT_TIMEOUT,
    poll: 1,
  });

  await captureStill(h, "pieces");

  assertEqual(
    swept.hit,
    true,
    `the bolt to remove a segment within ${BOLT_TIMEOUT} frames`,
  );
  assertLength(swept.snapshot.worms, 2, "worms left on the board");
  assertEqual(
    wormOn(swept.snapshot, HEAD_C, ROW)?.id,
    id,
    "the piece carrying the old head reports the id the worm had",
  );
  const trailing = wormOn(swept.snapshot, TAIL_C, ROW);
  assertDefined(
    trailing,
    `a worm standing on the old tail tile (${TAIL_C}, ${ROW})`,
  );
  assertNotEqual(
    trailing?.id,
    id,
    "the trailing piece reports an id of its own",
  );
});

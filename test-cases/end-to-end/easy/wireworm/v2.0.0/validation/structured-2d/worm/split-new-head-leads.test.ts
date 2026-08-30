// worm/split-new-head-leads — the trailing piece leads from the segment nearest
// the break, and steps along its own heading.
//
// specs/worm.md, Cutting the worm: "Each further run becomes a new worm, taking
// a fresh id and the same two headings and diving flag as the worm it came
// from. Its leading segment is the one that was nearest the break, and that
// segment is its head and leads it from then on." The rule has two halves —
// WHICH segment leads, and that it really LEADS — and both are read here,
// because a build that named the wrong end of the run as its head would still
// report a worm of the right length standing on the right tiles.
//
// THE WORM IS POSED BENT, and the bend is what makes the second half readable.
// The chain runs
//
//   (14,5) (15,5) (16,5) (17,5) | (17,4) (18,4) (19,4)
//
// heading LEFT, and the bolt takes `(17,5)` — the fourth segment from the head,
// and the LOWEST segment in column 17, so it is the first thing the climbing
// bolt reaches (specs/cursor.md). The trailing run is therefore `(17,4)`,
// `(18,4)`, `(19,4)`, led by `(17,4)`, and its first step carries it to
// `(16,4)`: an empty tile, on a row the head-side run never touches and clear
// of the fresh node the cut leaves on `(17,5)`. A straight worm would have put
// that node directly in the trailing head's way, and this point would have been
// deciding `nodes.shot-leaves-node` instead.
//
// THE STEP IS DRIVEN THROUGH THE TRAILING WORM'S OWN GATE. The posed worm's
// `stepping` is held off so the chain the bolt arrives at is the chain that was
// posed, and specs/instrumentation.md leaves what a cut does to a faculty gate
// unstated — so the gate is turned back on explicitly, by id, on the piece
// whose stepping this point is about. The head-side piece is left as it stands.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE, WORM_STEP_L1 } from "../../src/constants";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWormPath,
  segmentTiles,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
  type Tile,
} from "../harness";

/** The bent chain, head first, exactly as the header draws it. */
const CHAIN: readonly Tile[] = [
  { c: 14, r: 5 },
  { c: 15, r: 5 },
  { c: 16, r: 5 },
  { c: 17, r: 5 },
  { c: 17, r: 4 },
  { c: 18, r: 4 },
  { c: 19, r: 4 },
];

/** The worm's heading: left, and descending. */
const DH = -1;
const DV = 1;

/** The segment the bolt takes, and where the trailing run then leads from. */
const CUT: Tile = { c: 17, r: 5 };
const LEADS: Tile = { c: 17, r: 4 };
const FURTHEST: Tile = { c: 19, r: 4 };

/** Where the bolt starts: the cut segment's column, seven rows below it. */
const BOLT_R = CUT.r + 7;

/**
 * How long the bolt may take to arrive, in frames: twice the `0.249` s that
 * seven tiles of `TILE` (`32`) units take at `BOLT_SPEED` (`900` units per
 * second). A bound on a bolt that never resolved, not a tolerance.
 */
const BOLT_TIMEOUT = ticksFor(((BOLT_R - CUT.r) * TILE * 2) / BOLT_SPEED);

/**
 * How long the trailing worm's first step may take, in frames. Four of level
 * 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leads the trailing piece from the segment nearest the break", async () => {
  startPlaying(h);
  const id = poseWormPath(h, CHAIN, DH, DV);
  h.debug.setWormStepping(id, false);

  poseBoltAtTile(h, CUT.c, BOLT_R);
  const cut = await h.until((s) => segmentTiles(s).length < CHAIN.length, {
    maxFrames: BOLT_TIMEOUT,
    poll: 1,
  });
  assertEqual(
    cut.hit,
    true,
    `the bolt to remove a segment within ${BOLT_TIMEOUT} frames`,
  );
  assertLength(cut.snapshot.worms, 2, "worms left on the board");

  const trailing = wormOn(cut.snapshot, FURTHEST.c, FURTHEST.r);
  assertDefined(
    trailing,
    `a worm standing on (${FURTHEST.c}, ${FURTHEST.r}), the far end of the trailing run`,
  );
  // Half one: the segment nearest the break is the piece's head.
  assertDeepEqual(
    trailing?.segments[0],
    LEADS,
    "the trailing piece's leading segment",
  );

  // Half two: it really leads. The gate is turned on by id, on this piece only.
  const trailingId = trailing?.id ?? id;
  h.debug.setWormStepping(trailingId, true);
  // The HEAD is what is watched, not the tile: the body follows into the tile
  // the head vacates, so a tile-shaped predicate would sit through three steps
  // before the chain finally cleared it.
  const stepped = await h.until(
    (s) => {
      const head = wormById(s, trailingId)?.segments[0];
      return head !== undefined && !(head.c === LEADS.c && head.r === LEADS.r);
    },
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );

  captureStill(h, "trailing");

  assertEqual(
    stepped.hit,
    true,
    `the trailing piece to step within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(stepped.snapshot, trailingId)?.segments[0],
    { c: LEADS.c + DH, r: LEADS.r },
    "the trailing piece's head, one tile on along the heading it inherited",
  );
});

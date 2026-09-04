// nodes/field-persists — the field carries into the next level unchanged.
//
// specs/nodes.md: "The field is laid once, when a run starts, and it stands from
// there. Clearing a level does not reset it. The nodes standing when a level
// clears are the nodes standing when the next level's play begins, at the charges
// they held." specs/progression.md states the same from the run's side, in what a
// clear does: "Every foe and every bolt in flight is removed. The node field
// stands exactly as it was, at the charges it held."
//
// THE FIELD IS POSED WITH ALL FOUR CHARGES on twelve tiles, so a build that keeps
// the tiles and drops the charges, keeps the charges and drops some tiles, or lays
// a fresh scatter over the top of it — the scatter is `SCATTER_MIN_FRACTION` of
// `680` tiles, at least sixty-eight of them, all inert — all read back as
// something different from what was posed.
//
// THE CLEAR IS REACHED THROUGH THE ONE ROUTE THAT PRODUCES ONE. specs/progression.md:
// "A level clears on the step in which the last of its worm segments is removed."
// So the board holds one motionless one-segment worm, well away from the field,
// and one bolt beneath it. Both of the worm's faculties are off, so it stands
// where it was posed and the bolt strikes it there.
//
// THE DOOMED SEGMENT STANDS ON AN INERT NODE, so the kill that produces the clear
// leaves the field exactly as this check posed it and the reading needs no
// allowance for it: specs/nodes.md has a bolt-killed segment lay a fresh node at
// charge `0` "unless the tile already holds a node", in which case "no new node is
// laid and the standing node keeps the charge it had". Posed at charge `0`, both
// halves of that sentence leave the same tile behind, so a build that lays a fresh
// node regardless is docked at `nodes.shared-tile-keeps-charge` and not here. The
// comparison is therefore against the field as it was POSED — the strongest form
// of the sentence, and the one that catches a clear which empties the field and
// then reports the emptiness consistently.
//
// WHAT THIS DOES NOT DECIDE. That the clear happens, that the level goes up, and
// that the banner gives way to play are `progression.level-clears-on-last-segment`,
// `progression.level-advances` and `progression.level-banner`'s requirements. A
// build that never advances holds a field that never changed, and is docked there
// rather than twice.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, BOLT_SPEED, TILE } from "../../src/constants";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseField,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The field posed, its top-left tile, and how many nodes it holds.
 *
 * Twelve tiles carrying all four charge states, laid inside the scatter rows and
 * far from the column the worm is shot in.
 */
const FIELD = ["0123", "3210", "1032"] as const;
const FIELD_C = 5;
const FIELD_R = 3;
const FIELD_NODES = 12;

/** The tile the worm stands on, well away from the field and clear of the band. */
const WORM_C = 30;
const WORM_R = 15;

/** The whole field posed: the twelve-tile patch, plus the tile under the worm. */
const POSED_NODES = FIELD_NODES + 1;

/** How far below the worm the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the segment's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/**
 * How long the next level's play is waited for, in frames.
 *
 * specs/progression.md puts the phase at `banner` on a clear "with its timer at
 * `BANNER_TIME`" (`1.3` s), so a conforming build reaches `active` within it. A
 * quarter of a second of slack covers the frame the clear itself landed on, and
 * the bound is hard: a build that never gives way is read where it stands rather
 * than running the suite out.
 */
const BANNER_TICKS = ticksFor(BANNER_TIME + 0.25);

/**
 * The field as a sorted list of `"c,r=charge"`, which is what two readings are
 * compared as.
 *
 * Sorted, so the comparison is of the field itself and not of the order the
 * snapshot happened to report it in — the order is fixed by
 * specs/instrumentation.md and read by `instrumentation.snapshot-shape`, and this
 * point should not be a second reading of it.
 */
function field(snapshot: WirewormSnapshot): string[] {
  return snapshot.nodes
    .map((node) => `${node.c},${node.r}=${node.charge}`)
    .sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the next level on the field the clear left standing", async () => {
  startPlaying(h);
  poseField(h, FIELD, FIELD_C, FIELD_R);
  h.debug.setNode(WORM_C, WORM_R, 0);
  // The pose has to have taken for the comparison to say anything: a surface that
  // could not lay the field fails the point it decides.
  const posed = field(h.snapshot());
  assertLength(posed, POSED_NODES, "the nodes the pose laid");

  const worm = poseWorm(h, WORM_C, WORM_R, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBolt(h, WORM_C, WORM_R + BOLT_DROP_TILES);

  await h.until((s) => s.worms.length === 0, { maxFrames: BOLT_TICKS });
  await h.until((s) => s.phase === "active" && s.level === 2, {
    maxFrames: BANNER_TICKS,
  });
  captureStill(h, "carried");

  assertDeepEqual(
    field(h.snapshot()),
    posed,
    "the field standing as the next level's play begins",
  );
});

// presentation/ground-flyer-boss-read-apart — the three kinds of intruder are
// told apart at a glance.
//
// THE RULE. specs/overview.md's legibility table: "Ground units, flyers, and the
// boss read apart from one another." specs/surge.md is what says which is which —
// the Mote is the baseline ground unit, the Drift is the flyer and ignores the
// maze entirely, and the Core is the boss. A player has to answer a different
// question for each: whether to build a wall, whether a Flak is in range, and
// whether the run is about to end. So the three are read against each other, and
// against each other alone.
//
// HOW A UNIT IS READ. At the centre it reports (specs/instrumentation.md), over a
// cluster two units across — see presentation/read.ts on why that is tighter than
// the harness's tile-scale sample.
//
// WHAT IS COMPARED. specs/overview.md fixes no palette, so all three colours are
// the build's; what is asserted is the distance between them, pairwise, and
// nothing else. Nothing here asserts a SHAPE: a build may well tell its flyer
// from its ground unit by drawing one as a diamond and the other as a disc, and
// that is a fine way to do it, but a shape is not something a check can read off
// a pixel and the legibility table asks only that they read apart.
//
// WHY EACH IS POSED AND NOT WALKED IN. The three stand still on their own tiles,
// well clear of each other, on an empty floor with the run's own release of surge
// held. The requirement is about how a build DRAWS three types, so the check poses
// exactly those three and nothing else.
//
// WHAT IT DOES NOT DECIDE. Whether each reads apart from the FLOOR is
// `surge-reads-apart-from-the-floor`, and whether any of them reads as heat is
// `surge-off-the-heat-axis`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  startRun,
  type Harness,
  type SurgeType,
} from "../harness";
import { showRgb, spotColor, unitOf } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, any two of the three must read.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at.
 */
const APART_MIN = 50;

/**
 * The three the point names, and where each stands: the ground unit, the flyer
 * and the boss (specs/surge.md), eight tiles apart on one row, which is clear of
 * the largest of them at any size a build draws it.
 */
const KINDS: readonly { type: SurgeType; what: string; col: number }[] = [
  { type: "mote", what: "the ground unit", col: 8 },
  { type: "drift", what: "the flyer", col: 16 },
  { type: "core", what: "the boss", col: 24 },
];

/** The row the three stand on. */
const KIND_ROW = 8;

/** The hp each is posed with, so its health bar is drawn full. */
const TARGET_HP = 10_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the ground unit, the flyer and the boss apart", async () => {
  startRun(h);
  const ids = KINDS.map(({ type, col }) =>
    poseTarget(h, type, col, KIND_ROW, TARGET_HP),
  );
  await h.advance(1);
  captureStill(h, "kinds");

  const snapshot = h.snapshot();
  const read = ids.map((id) => {
    const unit = unitOf(snapshot, id);
    return spotColor(h, unit.x, unit.y);
  });

  for (let i = 0; i < KINDS.length; i += 1) {
    for (let j = i + 1; j < KINDS.length; j += 1) {
      assertGreaterThanOrEqual(
        colorDistance(read[i], read[j]),
        APART_MIN,
        `a ${KINDS[i].type}, ${KINDS[i].what} (${showRgb(read[i])}), against ` +
          `a ${KINDS[j].type}, ${KINDS[j].what} (${showRgb(read[j])}), out of ` +
          `441 (specs/overview.md: ground units, flyers and the boss read ` +
          `apart from one another)`,
      );
    }
  }
});

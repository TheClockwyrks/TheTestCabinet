// Meltdown — movers/forge-scales-with-shared-edges: the Forge scales with the
// contact.
//
// `specs/heat.md` multiplies the Forge's flow by `sharedEdges(T, F)` and sums it
// over every Forge the emitter touches, so what a gun takes from the Forges
// against it is proportional to how many edge-tiles of contact they have with it.
// Twice the contact, twice the flow.
//
// WHY THE SUBJECT IS A LANCE. A face is one edge-tile long per tile of the
// footprint's side (`specs/heat.md`), and both movers are 2x2 at every level
// (`specs/towers.md`) — so a 2x2 Forge presents two edge-tiles and no more,
// whatever it is put against. A contact of FOUR therefore needs a face four
// edge-tiles long, which is the Lance's 4x4, with both halves of that face
// covered. The specification's own sum is over every touching Forge, so two
// Forges filling one 4x4 face are a contact of `2 + 2` edge-tiles.
//
// THE CONTACT IS VARIED AND NOTHING ELSE IS. Two Lances at the same heat `20`,
// each with all sixteen of its edge-tiles covered, differing only in what covers
// the second half of the north face:
//
//   - four edge-tiles of Forge: both halves of the north face are level-I
//     Forges, so the flow is `0.9 * 4 * 52`;
//   - two edge-tiles of Forge: the first half is a level-I Forge and the second
//     is a plain wall at the Lance's own heat, so the flow is `0.9 * 2 * 52`.
//
// Both subjects are the same type at the same heat, so their mass cancels out of
// the ratio; the air term is exactly zero in both, because every edge-tile faces
// a tower; and every plain wall is at the subject's heat, so it conducts nothing
// — a gradient of zero rather than a faculty switched off. Both stand on ONE
// FLOOR and are read in ONE FRAME, so no wall's own cooling can reach either
// subject and nothing separates the two readings but the contact.
//
// WHAT THIS NAMES. A build whose Forge flow does not scale with the width of the
// contact at all reads a ratio of `1`, and so does a build that takes only the
// first Forge it finds against a face. It does NOT separate a build counting
// whole FACES from one counting edge-tiles — two Forges are two faces as readily
// as four edge-tiles — which is why the per-edge-tile counting is decided on the
// air term, where one face's length can be varied, by `heat/edge-tiles-count`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { SLOT, poseBoxed, readHeat } from "./contact";

/** The gun read on both legs: the only footprint with a four-edge-tile face. */
const GUN: TowerType = "lance";

/** The heat both legs open at, well below the level-I setpoint of 72. */
const HEAT = 20;

/** The Forge level on both legs: the contact is the only thing that varies. */
const LEVEL = 1;

/** A 2x2 Forge presents two edge-tiles; two of them across one face present four. */
const NARROW_EDGES = SLOT;
const WIDE_EDGES = 2 * SLOT;

/** What the specification requires of the ratio: four edge-tiles over two. */
const EXPECTED_RATIO = WIDE_EDGES / NARROW_EDGES;

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, a quarter of one percent of the `2` required. Each
 * change is one frame of a build's own arithmetic over an arrangement that
 * differs from the other only in what covers half of one face, so a conformant
 * build lands on `2` to within float slack. The bound is two hundred times
 * smaller than the distance to the wrong model this point exists to name: a
 * Forge flow that ignores the width of the contact reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Forge scales with the contact", async () => {
  await startRun(h);
  const wide = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [
      { type: "forge", side: "N", slot: 0, level: LEVEL },
      { type: "forge", side: "N", slot: 1, level: LEVEL },
    ],
    0,
  );
  const narrow = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [{ type: "forge", side: "N", slot: 0, level: LEVEL }],
    1,
  );

  const openedWide = await readHeat(h, wide.id, "the four-edge contact");
  const openedNarrow = await readHeat(h, narrow.id, "the two-edge contact");
  await h.advance(1);
  await captureStill(h, "contact");
  const wideGain =
    (await readHeat(h, wide.id, "the four-edge contact, a frame on")) -
    openedWide;
  const narrowGain =
    (await readHeat(h, narrow.id, "the two-edge contact, a frame on")) -
    openedNarrow;

  assertGreaterThan(
    narrowGain,
    0,
    `the ${GUN} at ${HEAT} really gains heat across a contact of ` +
      `${NARROW_EDGES} edge-tiles`,
  );
  assertCloseTo(
    wideGain / narrowGain,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the gain across ${WIDE_EDGES} edge-tiles of Forge over the gain across ` +
      `${NARROW_EDGES}`,
  );
});

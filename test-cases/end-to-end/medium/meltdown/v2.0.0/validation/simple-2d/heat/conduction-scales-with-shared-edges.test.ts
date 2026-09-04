// Meltdown — heat/conduction-scales-with-shared-edges: conduction scales with the contact.
//
// specs/heat.md multiplies conduction by `sharedEdges(T, N)` and sums it over
// every emitter `T` touches, so what a tower loses to cooler neighbours is
// proportional to how many edge-tiles of contact it has with them. Twice the
// contact, twice the flow.
//
// THE CONTACT IS VARIED AND NOTHING ELSE IS. Both arrangements are the same Arc
// at heat `90` with all four faces walled, at the same heat as it except where
// the contact is being counted:
//
//   - four cool edge-tiles: cool Arcs at `10` against the N and S faces, and
//     walls at `90` against E and W, so the flow is `3.5 * 4 * 80`;
//   - two cool edge-tiles: a cool Arc at `10` against N alone, and walls at `90`
//     against E, S and W, so the flow is `3.5 * 2 * 80`.
//
// The subject is the same type at the same heat in both, so its mass and its
// footprint cancel; the air term is exactly zero in both, because every one of
// its edge-tiles faces a tower; and the warm walls conduct nothing, because two
// emitters at the same heat exchange nothing — a gradient of zero rather than a
// faculty switched off. So the ratio of the two changes is the ratio of the two
// contacts and nothing else.
//
// Each reading is one frame, so no neighbour's own cooling can reach the subject,
// and each arrangement is posed on a floor of its own.
//
// A build that conducts per FACE rather than per edge-tile reads a ratio of `2`
// here as well, because two faces are twice one — which is why
// `heat/edge-tiles-count` decides the per-edge-tile counting on the air term,
// where a single face's length can be varied. What this item names is a build
// whose conduction does not scale with contact at all, and reads `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  towerOf,
  type Face,
  type Harness,
} from "../harness";
import { SIDES, wallFaces, type Footprint } from "./faces";
import { BOXED_SITE } from "./sites";

/** The subject and its walls, all one type so the arrangement is symmetric. */
const TOWER = "arc";

/** The heats: the subject and its warm walls, and the cool neighbours. */
const HOT = 90;
const COOL = 10;

/** One 2x2 face is two edge-tiles, so each cool neighbour is a contact of two. */
const EDGES_PER_FACE = sizeOf(TOWER);

/** What the specification requires of the ratio: four edge-tiles over two. */
const EXPECTED_RATIO = (2 * EDGES_PER_FACE) / EDGES_PER_FACE;

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, a quarter of one percent of the `2` required. Each
 * change is one frame of a build's own arithmetic over an arrangement that
 * differs from the other only in which faces carry a cooler neighbour, so a
 * conformant build lands on `2` to within float slack. The bound is two hundred
 * times smaller than the distance to the wrong model this item exists to name:
 * conduction that ignores the width of the contact reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The heat one frame takes off a fully walled Arc at `HOT` whose `cool` faces
 * carry a neighbour at `COOL` and whose other faces carry one at `HOT`.
 */
async function lossWithCoolFaces(cool: readonly Face[]): Promise<number> {
  startRun(h);
  const at: Footprint = {
    type: TOWER,
    col: BOXED_SITE.col,
    row: BOXED_SITE.row,
  };
  const id = poseIdleTower(h, TOWER, at.col, at.row, 0, HOT);
  const warm = SIDES.filter((face) => !cool.includes(face));
  wallFaces(h, at, cool, { wall: TOWER, heat: COOL });
  wallFaces(h, at, warm, { wall: TOWER, heat: HOT });

  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  return opened - towerOf(h.snapshot(), id).heat;
}

it("Conduction scales with the contact", async () => {
  const wideLoss = await lossWithCoolFaces(["N", "S"]);
  const narrowLoss = await lossWithCoolFaces(["N"]);
  captureStill(h, "contact");

  assertGreaterThan(
    narrowLoss,
    0,
    `the Arc at ${HOT} really loses heat across a contact of ` +
      `${EDGES_PER_FACE} edge-tiles`,
  );
  assertCloseTo(
    wideLoss / narrowLoss,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the loss across ${2 * EDGES_PER_FACE} cool edge-tiles over the loss ` +
      `across ${EDGES_PER_FACE}`,
  );
});

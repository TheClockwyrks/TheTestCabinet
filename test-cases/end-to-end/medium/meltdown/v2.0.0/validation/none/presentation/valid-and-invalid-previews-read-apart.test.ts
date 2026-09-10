// presentation/valid-and-invalid-previews-read-apart — a footprint that would be
// refused is drawn as refused.
//
// THE RULE. `specs/building.md`: "The held preview is drawn on the floor: the
// tiles of its footprint, drawn plainly apart valid and invalid", and
// `specs/overview.md`'s legibility table: "The build preview — A valid footprint
// and an invalid one read plainly apart". A player carries a preview over a floor
// deciding where a tower can go, so the footprint itself has to answer; a build
// that draws the same ghost either way makes a player press and find out.
//
// THE ONE VARIABLE, AND WHY IT IS THE MONEY. `specs/building.md` gives six ways a
// footprint is invalid, and five of them change what is DRAWN on the tiles under
// the preview: a tower already there is drawn, a unit standing there is drawn, a
// tile off the grid is not floor, a build zone is marked, and a sealing placement
// needs a wall built to reach. The sixth — "The current money is at least the held
// type's build cost" — changes nothing on the floor at all. So the check holds one
// held preview, on one footprint, at one rotation, over two frames, and moves the
// money across the type's cost between them. Every pixel that differs is the
// build's answer to "valid or not", because nothing else in the picture moved.
//
// WHERE IT IS READ, AND WHERE THE BAR COMES FROM. The footprint's own rectangle,
// `specs/floor.md`'s `size x size` tiles anchored at `(col, row)`: a ring of
// points just inside its edge, where a build that outlines its preview draws, and
// a grid over its interior, where one that tints it draws. The reading is the
// position at which the two frames diverge MOST (`widestGap`), because either
// treatment alone satisfies the requirement and neither is required. How far the
// two must diverge is not a stated distance — `specs/overview.md` hands the
// palette to the build — so it is measured: the valid footprint is read on two
// frames, which is how much the preview moves on its own, and the refusal has to
// beat that by `NOISE_MARGIN`.
//
// WHY THE REPORTED VALIDITY IS CHECKED FIRST. The scenario needs the game to be
// holding a valid preview on the first frame and an invalid one on the second;
// whether the money rule is applied correctly is `building/`'s item, not this
// one. So the two `valid` flags are read off the snapshot and named before any
// pixel is: a build that answers them the same way both times has not reached the
// situation this item is about, and it fails saying so rather than failing for
// drawing two identical frames.
//
// WHAT IT DOES NOT DECIDE. Which footprints ARE valid is `building/`'s items, the
// range ring the preview also carries is `presentation/range-ring-drawn`, and the
// preview's radiator faces are `presentation/radiator-faces-*`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  TILE,
  TOWER_DEFS,
  footprintCentre,
  tileLeft,
  tileTop,
} from "../constants";
import type { TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type BuildView,
  type Harness,
  type Rgb,
} from "../harness";
import {
  NOISE_MARGIN,
  readPixels,
  showRgb,
  widestGap,
  type Point,
} from "./read";

/** The type held, its cost, and where it is carried. */
const TYPE: TowerType = "arc";
const COST = TOWER_DEFS[TYPE].cost;
const SIZE = TOWER_DEFS[TYPE].size;
const AT = { col: 12, row: 8 } as const;

/** Money the two frames are posed at: comfortably above the cost, and below it. */
const RICH = COST * 10;
const POOR = COST - 1;

/** How far inside the footprint's edge the outline ring is read, in units. */
const EDGE_DEPTHS: readonly number[] = [1, 2, 3];

/** How many points across the footprint the interior grid carries, per side. */
const INTERIOR_STEPS = 7;

/** Every point of the footprint this check reads, edge ring then interior. */
function footprintPoints(col: number, row: number, size: number): Point[] {
  const x0 = tileLeft(col);
  const y0 = tileTop(row);
  const w = size * TILE;
  const points: Point[] = [];
  for (const depth of EDGE_DEPTHS) {
    for (let n = 1; n < INTERIOR_STEPS; n += 1) {
      const along = (n / INTERIOR_STEPS) * w;
      points.push(
        { x: x0 + along, y: y0 + depth },
        { x: x0 + along, y: y0 + w - depth },
        { x: x0 + depth, y: y0 + along },
        { x: x0 + w - depth, y: y0 + along },
      );
    }
  }
  for (let a = 1; a < INTERIOR_STEPS; a += 1) {
    for (let b = 1; b < INTERIOR_STEPS; b += 1) {
      points.push({
        x: x0 + (a / INTERIOR_STEPS) * w,
        y: y0 + (b / INTERIOR_STEPS) * w,
      });
    }
  }
  return points;
}

/** Pose the money, run a frame, keep the picture, and read the footprint. */
async function previewAt(
  h: Harness,
  money: number,
  outputId: string,
): Promise<{ valid: boolean; pixels: Rgb[] }> {
  await h.debug.setMoney(money);
  await h.advance(1);
  await captureStill(h, outputId);
  const held = (await h.snapshot()).build;
  assertNotNull(
    held,
    `a preview of the armed type still held with ${money} money ` +
      `(specs/building.md: a held preview is cleared by disarming alone)`,
  );
  assertEqual(
    (held as BuildView).col,
    AT.col,
    `posing: the column the pose and the pointer both hold the ${TYPE}'s ` +
      `footprint on, which is the patch of floor this reading is taken over ` +
      `(specs/building.md)`,
  );
  assertEqual(
    (held as BuildView).row,
    AT.row,
    `posing: the row the pose and the pointer both hold the ${TYPE}'s ` +
      `footprint on, which is the patch of floor this reading is taken over ` +
      `(specs/building.md)`,
  );
  return {
    valid: (held as BuildView).valid,
    pixels: await readPixels(h, footprintPoints(AT.col, AT.row, SIZE)),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a refused footprint apart from one it would accept", async () => {
  await startRun(h);
  await h.debug.setArmed(TYPE);
  // THE PREVIEW IS PUT ON ITS TILE BOTH WAYS: POSED, AND BY THE POINTER.
  // This reading is of the FINISHED PICTURE and so needs frames to run with the
  // preview held — and a frame hands the build a frame of input, which nothing
  // in `specs/instrumentation.md` makes a pose survive: a build that reads
  // `specs/building.md`'s "The preview follows the pointer" as the invariant it
  // is written as re-derives the held footprint from the pointer on every frame,
  // and a posed preview plus a frame would put the preview back under a pointer
  // that never moved. So both routes are taken, and both name the same tile:
  // `setPreview` puts the footprint's top-left there "exactly where the call
  // names it", and the pointer is moved to the footprint's centre so a build
  // re-deriving from `specs/controls.md`'s "the `size x size` block nearest the
  // pointer" derives the same block. A build that keeps its pose keeps it; a
  // build that re-derives derives this tile; and the read-back below fires only
  // when NEITHER route put the footprint where this reading is taken. Whether
  // the pointer alone moves the preview is `controls/pointer-moves-the-preview`,
  // which is the point that owns it — it is not charged here as well.
  const centre = footprintCentre(AT.col, AT.row, SIZE);
  await h.debug.setPreview(AT.col, AT.row);
  await h.debug.pointerMove(centre.x, centre.y);
  await h.advance(1);

  const accepted = await previewAt(h, RICH, "valid");
  await h.advance(1);
  const held = await readPixels(h, footprintPoints(AT.col, AT.row, SIZE));
  const noise = widestGap(accepted.pixels, held).distance;
  const refused = await previewAt(h, POOR, "invalid");

  assertEqual(
    accepted.valid,
    true,
    `the held ${TYPE} on tile (${AT.col}, ${AT.row}) with ${RICH} money, ` +
      `which is above its ${COST} build cost, reads as placeable ` +
      `(specs/building.md: a footprint is valid when the money is at least ` +
      `the held type's build cost, among five other conditions this floor ` +
      `meets)`,
  );
  assertEqual(
    refused.valid,
    false,
    `the same footprint with ${POOR} money, which is below that ${COST} cost, ` +
      `reads as refused (specs/building.md)`,
  );

  const gap = widestGap(held, refused.pixels);
  assertGreaterThanOrEqual(
    gap.distance,
    noise + NOISE_MARGIN,
    `the held ${TYPE} on tile (${AT.col}, ${AT.row}): valid ` +
      `(${showRgb(gap.left)}) against the same footprint refused ` +
      `(${showRgb(gap.right)}), at the point the two frames differ most, past ` +
      `the ${noise} two frames of the valid footprint moved on their own ` +
      `(specs/building.md: the footprint is drawn plainly apart valid and ` +
      `invalid)`,
  );
});

// assets/tile-variants — each band has several rock stamps, and the wall uses them.
//
// `specs/assets.md`: "Band rock, at least `TILE_VARIANTS` (`3`) interchangeable
// variants per band, chosen per cell so a wall of one band never repeats a single
// stamp", produced at `assets/tiles/<band>-<n>.png`. Two halves, and both are
// read:
//
//   1. THE VARIANTS EXIST. Each of the four bands is counted at that path and each
//      of its variants must be a different drawing from its siblings — two files
//      holding one picture are one variant, whatever they are named.
//   2. THE WALL USES THEM. A block of one band's rock is laid and the picture
//      drawn over each of its cells is read back, and more than one of the band's
//      variants must appear across it. A build that ships three files and stamps
//      one of them everywhere has the files and not the requirement.
//
// The cells read are interior ones, so none of them carries the tunnel lip
// `specs/assets.md` has the build draw around a carved cell, and the miner is held
// away from the block so its sprite covers none of them. The numbering's starting
// point is not fixed, so the directory is read for every name of a band's shape.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BAND_ORDER, PLAYABLE_COL_MIN, TILE_VARIANTS } from "../constants";
import {
  captureStill,
  cellCenter,
  createHarness,
  fillBlock,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  rowInBand,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { imageAt, recordImages } from "./drawn";
import {
  allDistinct,
  producedNames,
  readPicture,
  type Picture,
} from "./produced";

/** The band the drawn wall is laid in. */
const BAND = "rockbed" as const;

/** The block of that band's rock the wall is read across. */
const FROM_COL = PLAYABLE_COL_MIN + 3;
const TO_COL = FROM_COL + 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces three variants per band and draws more than one in a wall", async () => {
  // The files, band by band.
  const counts: string[] = [];
  const wanted: string[] = [];
  for (const band of BAND_ORDER) {
    const names = producedNames("tiles").filter((name) =>
      new RegExp(`^${band}-\\d+\\.png$`).test(name),
    );
    const pictures: Picture[] = [];
    for (const name of names) {
      const picture = await readPicture(h, "tiles", name);
      if (picture !== null) pictures.push(picture);
    }
    counts.push(
      `${band}: ${pictures.length >= TILE_VARIANTS && allDistinct(pictures)}`,
    );
    wanted.push(`${band}: true`);
  }

  // And the wall the build draws out of them.
  await openScene(h);
  await pinDrill(h);
  const { coreRow } = await h.snapshot();
  const row = rowInBand(BAND, coreRow);
  await layFloor(h, row + 3);
  await standOn(h, PLAYABLE_COL_MIN, row + 3);
  await pinMiner(h);
  await fillBlock(
    h,
    { fromCol: FROM_COL, toCol: TO_COL, fromRow: row, toRow: row + 2 },
    "rock",
  );

  // One frame before anything is read: `specs/world.md` places the camera from the
  // miner each update, and a scene that has been posed and not yet run is still
  // looking wherever the last frame left it. A frame of no length places it and
  // moves no clock.
  await h.advanceSeconds(0, 1);
  const snapshot = await h.snapshot();
  const seen = new Set<number | null>();
  const { frames } = await recordImages(h, () => h.advanceSeconds(0, 1));
  const frame = frames[frames.length - 1];
  if (frame !== undefined) {
    for (let col = FROM_COL + 1; col < TO_COL; col += 1) {
      const centre = cellCenter(col, row + 1);
      const at = worldToStage(snapshot, centre.x, centre.y);
      const drawn = imageAt(frame, at);
      if (drawn !== null) seen.add(drawn.image);
    }
  }
  await captureStill(h, "wall");

  assertEqual(counts.join(", "), wanted.join(", "), "specs/assets.md");
  assertGreaterThan(seen.size, 1, "specs/assets.md");
});

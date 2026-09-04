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
// The picture is read as the `drawImage` over each cell rather than as its pixels,
// because a variant is a FILE: each produced PNG is decoded into an image of its
// own, so two cells drawn from one stamp name one image and two cells drawn from
// different stamps name two, whatever the grain looks like.
//
// The cells read are interior ones, so none of them carries the tunnel lip
// `specs/assets.md` has the build draw around a carved cell, and the miner is held
// away from the block so its sprite covers none of them. The numbering's starting
// point is not fixed, so the directory is read for every name of a band's shape.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN, TILE_VARIANTS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  BAND_ORDER,
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
import { frameImages, imageAt } from "./drawn";
import { allDistinct, producedNames, readPictures } from "./produced";

/** The band the drawn wall is laid in. */
const BAND = "rockbed" as const;

/** The block of that band's rock the wall is read across. */
const FROM_COL = PLAYABLE_COL_MIN + 3;
const TO_COL = FROM_COL + 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("produces three variants per band and draws more than one in a wall", async () => {
  // The files, band by band.
  const counts: string[] = [];
  const wanted: string[] = [];
  for (const band of BAND_ORDER) {
    const shape = new RegExp(`^${band}-\\d+\\.png$`);
    const names = producedNames("tiles").filter((name) => shape.test(name));
    const pictures = await readPictures(
      names.map((name) => ["tiles", name] as const),
    );
    counts.push(
      `${band}: ${pictures.length >= TILE_VARIANTS && allDistinct(pictures)}`,
    );
    wanted.push(`${band}: true`);
  }

  // And the wall the build draws out of them.
  openScene(h);
  pinDrill(h);
  const row = rowInBand(BAND, h.snapshot().coreRow);
  layFloor(h, row + 3);
  standOn(h, PLAYABLE_COL_MIN, row + 3);
  pinMiner(h);
  fillBlock(
    h,
    { fromCol: FROM_COL, toCol: TO_COL, fromRow: row, toRow: row + 2 },
    "rock",
  );

  // One frame before anything is read: `specs/world.md` places the camera from the
  // miner each update, and a scene that has been posed and not yet run is still
  // looking wherever the last frame left it.
  await h.advance(2);
  const snapshot = h.snapshot();
  const images = await frameImages(h);
  const seen = new Set<string>();
  for (let col = FROM_COL + 1; col < TO_COL; col += 1) {
    const centre = cellCenter(col, row + 1);
    const at = worldToStage(snapshot, centre.x, centre.y);
    const drawn = imageAt(images, at);
    if (drawn !== null) seen.add(drawn.key);
  }
  captureStill(h, "wall");

  assertEqual(counts.join(", "), wanted.join(", "), "specs/assets.md");
  assertGreaterThan(seen.size, 1, "specs/assets.md");
});

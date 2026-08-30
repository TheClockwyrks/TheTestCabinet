// assets/lava-shimmer — lava is a produced cycle that actually churns.
//
// `specs/assets.md`: "The lava shimmer: a looping cycle for a lava cell's molten
// interior, so lava glows and churns rather than sitting flat", produced under
// `assets/hazards/lava/frameNN.png`. Two halves, and both are read:
//
//   1. THE CYCLE EXISTS. At least two frames at that path, carrying at least two
//      different DRAWINGS — a "cycle" of one picture repeated is the flat lava the
//      requirement is written against. A frame that equals an earlier one is not
//      that: a shimmer that swells and settles comes back on itself, and a build
//      is graded on the drawings it made rather than on the order it plays them.
//   2. THE CELL CHURNS. One lava cell is posed on screen and the pixels over it
//      are read across a stretch of game time; they have to move. A build holding
//      every produced frame and drawing only the first has the files and not the
//      requirement.
//
// The miner is held well away from the cell and its travel and drill are held, so
// nothing touches the lava: `specs/assets.md` fires the lava-embers effect on
// contact, and an ember drifting over the cell would move the pixels for a reason
// that is not the shimmer.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN, TILE } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  cellCenter,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { boxChanged, sampleBox, type Box } from "./drawn";
import { cycleFrames, distinctCount, readPictures } from "./produced";
import { LAVA_FRAMES } from "./spec";

/** A deepstone row, the shallowest band `specs/world.md` puts lava in. */
const ROW = 300;
const MINER_COL = PLAYABLE_COL_MIN + 3;

/** How far from the miner the lava cell is laid, in columns. */
const APART = 4;

/** How long the cell is watched, in frames of the harness clock. */
const WATCH_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("produces a lava cycle and churns the cell it draws", async () => {
  const pictures = await readPictures(cycleFrames("hazards", "lava"));

  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, MINER_COL, ROW);
  pinMiner(h);
  const col = MINER_COL + APART;
  h.debug.setTile(col, ROW, "lava");
  await h.advance(2);

  const snapshot = h.snapshot();
  const centre = cellCenter(col, ROW);
  const at = worldToStage(snapshot, centre.x, centre.y);
  const cell: Box = {
    x: at.x - TILE / 3,
    y: at.y - TILE / 3,
    w: TILE / 1.5,
    h: TILE / 1.5,
  };

  const moved = await captureReplay(h, "lava", async () => {
    const opened = sampleBox(h, cell);
    let most = 0;
    for (let step = 0; step < WATCH_FRAMES; step += 1) {
      await h.advance(1);
      most = Math.max(most, boxChanged(opened, sampleBox(h, cell)));
    }
    return most;
  });

  assertGreaterThanOrEqual(
    pictures.length,
    LAVA_FRAMES,
    "assets/hazards/lava/frameNN.png (specs/assets.md)",
  );
  assertGreaterThanOrEqual(
    distinctCount(pictures),
    LAVA_FRAMES,
    "different drawings among assets/hazards/lava/ (specs/assets.md)",
  );
  assertGreaterThan(moved, 0, "specs/assets.md");
});

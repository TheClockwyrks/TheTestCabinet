// assets/lava-shimmer — lava is a produced cycle that actually churns.
//
// `specs/assets.md`: "The lava shimmer: a looping cycle of at least `LAVA_FRAMES`
// (`2`) frames for a lava cell's molten interior, so lava glows and churns rather
// than sitting flat", produced under `assets/hazards/lava/frameNN.png`. Two
// halves, and both are read:
//
//   1. THE CYCLE EXISTS. `LAVA_FRAMES` frames at that path, carrying at least
//      `DRAWINGS_MIN` different DRAWINGS — a "cycle" of one picture repeated is
//      the flat lava the requirement is written against. A frame that equals an
//      earlier one is not
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
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  DRAWINGS_MIN,
  LAVA_FRAMES,
  PLAYABLE_COL_MIN,
  TILE,
} from "../constants";
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
import { boxChanged, sampleBox } from "./drawn";
import {
  cycleFrames,
  distinctCount,
  readPicture,
  type Picture,
} from "./produced";

/** A deepstone row, the shallowest band `specs/world.md` puts lava in. */
const ROW = 300;
const MINER_COL = PLAYABLE_COL_MIN + 3;

/** How far from the miner the lava cell is laid, in columns. */
const APART = 4;

/** How long the cell is watched, in seconds, and in how many frames. */
const WATCH_SECONDS = 1;
const WATCH_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces a lava cycle and churns the cell it draws", async () => {
  const frames = cycleFrames("hazards", "lava");
  const pictures: Picture[] = [];
  for (const frame of frames) {
    const picture = await readPicture(h, frame);
    if (picture !== null) pictures.push(picture);
  }

  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, MINER_COL, ROW);
  await pinMiner(h);
  const col = MINER_COL + APART;
  await h.debug.setTile(col, ROW, "lava");
  await h.advanceSeconds(0, 1);

  const snapshot = await h.snapshot();
  const centre = cellCenter(col, ROW);
  const at = worldToStage(snapshot, centre.x, centre.y);
  const cell = {
    x: at.x - TILE / 3,
    y: at.y - TILE / 3,
    w: TILE / 1.5,
    h: TILE / 1.5,
  };

  const moved = await captureReplay(h, "lava", async () => {
    const opened = await sampleBox(h, cell);
    let most = 0;
    for (let step = 0; step < WATCH_FRAMES; step += 1) {
      await h.advanceSeconds(WATCH_SECONDS / WATCH_FRAMES, 1);
      most = Math.max(most, boxChanged(opened, await sampleBox(h, cell)));
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
    DRAWINGS_MIN,
    "different drawings among assets/hazards/lava/ (specs/assets.md)",
  );
  assertGreaterThan(moved, 0, "specs/assets.md");
});

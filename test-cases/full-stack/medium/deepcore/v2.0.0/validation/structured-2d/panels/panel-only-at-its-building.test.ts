// panels/panel-only-at-its-building — a building panel opens nowhere else.
//
// `specs/ui.md`: the five building panels open only while the miner stands at
// that building. The other direction of the point above it, so this reads what
// activating does AWAY from a building: in clear camp ground it opens nothing,
// and at one building it never opens another's panel.
//
// WHERE "CLEAR GROUND" IS. `specs/world.md` fixes only that the six footprints
// lie in columns 1-30, sit on the ground line, and are separated by at least
// `BUILDING_GAP`; where they sit is the build's, and how far a building reaches
// is the build's too. So the spot is computed rather than named: the point of the
// camp furthest from every footprint the build reports, which is the best ground
// any layout leaves. The camp is laid solid across its whole width for this, so
// the miner stands wherever that turns out to be.

import { afterEach, beforeEach, it } from "vitest";
import {
  MINER_W,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  TILE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  CAMP_MINER_Y,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  placeAt,
  standAtBuilding,
  type BuildingBox,
  type Harness,
} from "../harness";

/** The five buildings that carry a panel. */
const PANELLED: readonly string[] = [
  "fuel-depot",
  "ore-market",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
];

/** How finely the camp is sampled when looking for its emptiest ground. */
const PROBE_STEP = 8;

/** Frames the clip runs on after the reading, so it is a clip rather than a frame. */
const SETTLE = 60;

/** The centre of the widest stretch of camp ground no footprint stands on. */
function clearestX(boxes: readonly BuildingBox[]): number {
  const from = PLAYABLE_COL_MIN * TILE + MINER_W / 2;
  const to = (PLAYABLE_COL_MAX + 1) * TILE - MINER_W / 2;
  let best = from;
  let bestGap = -1;
  for (let x = from; x <= to; x += PROBE_STEP) {
    let gap = Number.POSITIVE_INFINITY;
    for (const box of boxes) {
      gap = Math.min(gap, Math.max(box.x - x, x - (box.x + box.w), 0));
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = x;
    }
  }
  return best;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens no panel away from a building, and never another's", async () => {
  openScene(h);
  layFloor(h, 1);
  pinDrill(h);

  const boxes = h.debug.buildings();
  const clear = clearestX(boxes);

  const inTheOpen = await captureReplay(h, "clear", async () => {
    h.debug.setPanel(null);
    placeAt(h, clear - MINER_W / 2, CAMP_MINER_Y);
    await h.tap(ACTION_KEY.activate);
    const opened = h.snapshot().panel;
    // The reading is taken above, on the frame the press ran; the rest of the
    // section is the camp carrying on with nothing open, which is what the review
    // item's clip is a picture of.
    await h.advance(SETTLE);
    return opened;
  });

  const wrong: string[] = [];
  for (const building of PANELLED) {
    h.debug.setPanel(null);
    standAtBuilding(h, building);
    await h.tap(ACTION_KEY.activate);
    const { panel } = h.snapshot();
    if (panel !== null && panel !== building) {
      wrong.push(`${building}:${panel}`);
    }
  }

  assertEqual(inTheOpen, null, "specs/ui.md");
  assertEqual(wrong.join(", "), "", "specs/ui.md");
});

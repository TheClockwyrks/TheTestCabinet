// hud/bar-always-visible — the status bar is never drawn over.
//
// `specs/overview.md` fixes the band: the status bar occupies `y` in `[0, HUD_H]`
// and the mine viewport everything below it, and `specs/ui.md` requires the bar
// always fully visible while `in-mine`. So two things are read, and neither of
// them needs a palette or a layout:
//
//   1. SOMETHING IS DRAWN THERE, at the camp and at the bottom of the mine alike.
//      A band that came back one flat color at either is a bar that is not on
//      screen.
//   2. THE WORLD IS NOT. The bar is read at two columns of the SAME deep row, so
//      every figure it shows is identical and the world behind it is completely
//      different, and the two reads must match pixel for pixel. A bar the mine
//      draws over, or shows through, cannot. How much of the band changes between
//      the camp and the deep is the build's LAYOUT and is read nowhere here:
//      `specs/overview.md` fixes the band's extent and `specs/ui.md` that it stays
//      fully visible, and neither says how much of it moves with the depth.
//
// A generated mine is used rather than a cleared one, because the point is that
// the rock, the ore, the lava and the boulders of two different stretches of the
// coreshell make no difference to the band. The miner is held still and its drill
// held, and its fuel and hull are re-posed before each read, so nothing the bar
// itself reports has moved between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HULL_MAX, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  stageTiers,
  type Harness,
} from "../harness";
import { changed, sampleBar, varied } from "./bar";

/** A row deep in the coreshell at the Standard size. */
const DEEP_ROW = 400;

/** Two columns far apart, so the mine behind the bar is nothing like itself. */
const WEST_COL = PLAYABLE_COL_MIN + 4;
const EAST_COL = PLAYABLE_COL_MAX - 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bar drawn and unobscured at the camp and deep alike", async () => {
  await openScene(h);
  await h.debug.generateMine();
  await pinMiner(h);
  await pinDrill(h);
  await stageTiers(h, { hull: 5 });
  await h.debug.setNoticeFired("gas", true);
  await h.debug.setNoticeFired("lava", true);

  const rest = async (): Promise<void> => {
    await h.debug.setMinerVelocity(0, 0);
    await h.debug.setFuel(100);
    await h.debug.setHull(HULL_MAX[4]);
  };

  await layCamp(h);
  await standAtCamp(h);
  await rest();
  const camp = await sampleBar(h);

  await h.debug.setMinerPosition(minerXOn(WEST_COL), minerYOn(DEEP_ROW));
  await rest();
  const west = await sampleBar(h);

  await h.debug.setMinerPosition(minerXOn(EAST_COL), minerYOn(DEEP_ROW));
  await rest();
  const east = await sampleBar(h);
  await captureStill(h, "bar");

  assertGreaterThan(varied(camp), 0, "specs/ui.md");
  assertGreaterThan(varied(west), 0, "specs/ui.md");
  assertEqual(changed(west, east), 0, "specs/overview.md");
});

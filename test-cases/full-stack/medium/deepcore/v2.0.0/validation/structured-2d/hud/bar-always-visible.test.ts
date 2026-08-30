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
//      draws over, or shows through, cannot.
//
// A generated mine is used rather than a cleared one, because the point is that
// the rock, the ore, the lava and the boulders of two different stretches of the
// coreshell make no difference to the band. The miner is held still and its drill
// held, and its fuel and hull are re-posed before each read, so nothing the bar
// itself reports has moved between them.

import { afterEach, beforeEach, it } from "vitest";
import {
  HULL_TIERS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
} from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";
import { changed, sampleBar, varied } from "./bar";

/** A row deep in the coreshell at the Standard size. */
const DEEP_ROW = 400;

/** Two columns far apart, so the mine behind the bar is nothing like itself. */
const WEST_COL = PLAYABLE_COL_MIN + 4;
const EAST_COL = PLAYABLE_COL_MAX - 4;

/**
 * How much of the band may differ between the camp and the deep, as a share.
 *
 * The one reading `specs/ui.md` puts on the bar that MUST differ between the two
 * is the depth in meters, which is a few digits. A band that came back largely
 * different is a band the mine is drawing into.
 */
const DEPTH_ONLY_SHARE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the bar drawn and unobscured at the camp and deep alike", async () => {
  openScene(h);
  h.debug.generateMine();
  pinMiner(h);
  pinDrill(h);
  stageTiers(h, { hull: 5 });
  h.debug.setNoticeFired("gas", true);
  h.debug.setNoticeFired("lava", true);

  const rest = (): void => {
    h.debug.setMinerVelocity(0, 0);
    h.debug.setFuel(100);
    h.debug.setHull(HULL_TIERS[4]);
  };

  layCamp(h);
  standAtCamp(h);
  rest();
  const camp = await sampleBar(h);

  h.debug.setMinerPosition(minerXOn(WEST_COL), minerYOn(DEEP_ROW));
  rest();
  const west = await sampleBar(h);

  h.debug.setMinerPosition(minerXOn(EAST_COL), minerYOn(DEEP_ROW));
  rest();
  const east = await sampleBar(h);
  captureStill(h, "bar");

  const samples = west.length / 3;

  assertGreaterThan(varied(camp), 0, "specs/ui.md");
  assertGreaterThan(varied(west), 0, "specs/ui.md");
  assertEqual(changed(west, east), 0, "specs/overview.md");
  assertLessThan(
    changed(camp, west) / samples,
    DEPTH_ONLY_SHARE,
    "specs/overview.md",
  );
});

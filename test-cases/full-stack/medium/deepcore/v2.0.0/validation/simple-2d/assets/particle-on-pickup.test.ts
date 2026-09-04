// assets/particle-on-pickup — the sparkle plays where an ore is banked.
//
// `specs/assets.md`: `ore-sparkle.json` fires when "An ore or gemstone is
// collected" and carries "A brief bright glint at the pickup, tinted to the ore".
//
// THE CONTROL IS THE SAME CUT WITHOUT THE ORE. A pickup can only be driven by
// cutting, and cutting has an effect of its own — the debris this same file's
// sibling point decides — so the drawing near the cell is counted over TWO cuts
// that differ in one thing: one cell holds an ore vein and the other holds the
// band's plain rock. `specs/world.md` gives both the same `BAND_HEALTH`, so both
// cuts take the same hits over the same frames and the two readings line up frame
// for frame. The ore cut must draw at least as much at every frame after the break
// and strictly more somewhere: that difference is the glint.
//
// The cell is a coreshell one so the cut is long and unmistakably ends at the
// break, the miner's travel is held so it does not fall into the hole it made, and
// the mine is otherwise cleared.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN, TILE } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  cellCenter,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  openScene,
  pinMiner,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { seriesNear } from "./effects";

const ROW = 450;
const COL = PLAYABLE_COL_MIN + 8;
const ORE = "cindrite" as const;

/** Frames read after the break, over which the glint has to show. */
const FRAMES = 30;

/** How far from the cell's centre a draw counts as being at the pickup. */
const RADIUS = TILE * 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws more at the cell when the cut banks an ore", async () => {
  /** Cut the same cell through, with or without an ore in it, and read after. */
  const cut = async (
    ore: boolean,
  ): Promise<{ broke: boolean; banked: number; series: number[] }> => {
    openScene(h);
    layFloor(h, ROW);
    if (ore) layOre(h, COL, ROW, ORE);
    standOn(h, COL, ROW);
    pinMiner(h);
    const driven = await driveCut(h, "down", { col: COL, row: ROW });
    const snapshot = h.snapshot();
    const centre = cellCenter(COL, ROW);
    const at = worldToStage(snapshot, centre.x, centre.y);
    return {
      broke: driven.broke,
      banked: snapshot.cargo.slotsUsed,
      series: await seriesNear(h, FRAMES, RADIUS, at),
    };
  };

  const plain = await cut(false);
  const banked = await captureReplay(h, "sparkle", () => cut(true));

  const short = banked.series.filter(
    (count, at) => count < plain.series[at],
  ).length;
  const extra = banked.series.filter(
    (count, at) => count > plain.series[at],
  ).length;

  assertEqual(plain.broke, true, "specs/mining.md");
  assertEqual(banked.broke, true, "specs/mining.md");
  assertEqual(plain.banked, 0, "specs/mining.md");
  assertEqual(banked.banked, 1, "specs/mining.md");
  assertEqual(short, 0, "specs/assets.md");
  assertGreaterThan(extra, 0, "specs/assets.md");
});

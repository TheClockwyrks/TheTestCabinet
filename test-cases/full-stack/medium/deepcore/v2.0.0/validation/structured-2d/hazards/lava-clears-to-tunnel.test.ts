// hazards/lava-clears-to-tunnel — a pool can be cut through.
//
// `specs/hazards.md` puts lava on the band's own terms for everything but the
// hull: "A lava cell drills exactly like its band's rock, taking the same hits,
// time and fuel, and clears to open tunnel." What that buys a player is a pool
// that costs rather than blocks, so the reading is a lava cell and a plain rock
// cell of the same band cut one after the other, held against each other for the
// frames the cut took and the fuel it spent, with the lava cell read back as
// open tunnel.
//
// Frames rather than seconds, because the two cuts run on the same clock: the
// same number of frames at the same cadence is the same time, and
// `specs/character.md` ties the hits, the time and the fuel together as
// `hits * DRILL_HIT_INTERVAL` and `hits * DRILL_HIT_FUEL`.
//
// The fuel comparison carries life support with it, which `specs/character.md`
// burns at `LIFE_SUPPORT_BURN` for every second below the ground line. Both cuts
// are underground and, if the rule holds, both take the same time, so the same
// life support rides on both sides of the comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { DRILL_HIT_FUEL } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  pinMiner,
  standOn,
  type CutResult,
  type Harness,
} from "../harness";
import { armHull, bandRow, FAST_DRILL_TIER, HAZARD_COL } from "./scene";

/** The tier whose hull survives the lava lump. */
const HULL_TIER = 5;

/** The two columns cut, one lava and one plain rock, in the same row. */
const LAVA_COL = HAZARD_COL;
const ROCK_COL = HAZARD_COL + 4;

/** How far the two fuel readings may sit apart: well under one hit's worth. */
const FUEL_TOLERANCE = DRILL_HIT_FUEL / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Cut one posed cell through and report the frames and the fuel it took. */
async function cutThrough(
  col: number,
  row: number,
  kind: "lava" | "rock",
): Promise<{ cut: CutResult; fuel: number }> {
  h.debug.setTile(col, row, kind);
  standOn(h, col, row);
  armHull(h, HULL_TIER);
  const before = h.snapshot().miner.fuel;
  const cut = await driveCut(h, "down", { col, row });
  return { cut, fuel: before - cut.snapshot.miner.fuel };
}

it("takes the same hits and fuel as its band's rock and clears to tunnel", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  h.debug.setTier("radiator", 1);
  const row = bandRow(h.snapshot(), "deepstone");

  const cuts = await captureReplay(h, "through", async () => {
    const lava = await cutThrough(LAVA_COL, row, "lava");
    const rock = await cutThrough(ROCK_COL, row, "rock");
    return { lava, rock };
  });

  assertEqual(cuts.lava.cut.broke, true, "specs/hazards.md");
  assertEqual(cuts.rock.cut.broke, true, "specs/character.md");
  assertEqual(cuts.lava.cut.tile.kind, "tunnel", "specs/hazards.md");
  assertEqual(
    cuts.lava.cut.frames,
    cuts.rock.cut.frames,
    "specs/hazards.md, the same hits and time as the band's rock",
  );
  assertBetween(
    cuts.lava.fuel,
    cuts.rock.fuel - FUEL_TOLERANCE,
    cuts.rock.fuel + FUEL_TOLERANCE,
    "specs/hazards.md, the same fuel as the band's rock",
  );
});

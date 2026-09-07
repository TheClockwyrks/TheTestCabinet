// assets/gas-seep-covers-every-pocket — every visible pocket breathes.
//
// `specs/hazards.md`: "Seeps are emitted over the gas pockets currently on screen
// so that every visible pocket wisps within `GAS_SEEP_PERIOD` (`2`) seconds: a
// player watching a suspect cell sees it breathe, and a player hurrying past does
// not. How the seeps are shared among the visible pockets is the build's own
// business." `specs/assets.md` gives the seep its produced system and describes it
// as "A faint wisp of pale gas rising from the cell".
//
// EVERY pocket is what this reads, and the sharing is deliberately not read. The
// specification fixes the guarantee — nothing goes unwisped for longer than a
// period — and leaves a build free to reach it however it likes, so a check that
// insisted on turn-taking would grade an implementation rather than the behaviour.
// Three pockets are posed across the view and all three are watched over ONE
// `GAS_SEEP_PERIOD`, in a single pass rather than one at a time, because the
// requirement is about what happens to all of them over the same stretch of time.
// Each cell has to draw more than it draws with no seep over it, and that baseline
// is taken from the same cells posed as PLAIN ROCK — which is exactly how
// `specs/overview.md` says a gas pocket is drawn, so the difference is the wisp and
// not the tile.
//
// THE WINDOW IS THE SECOND ONE, not the first. Whatever a build's sharing is
// timed off, it was not counting the pockets before they existed, so the period
// straight after they are posed is one the requirement says nothing about. A whole
// `GAS_SEEP_PERIOD` is let run first and the pockets are watched over the one
// after it, which is the steady state the sentence describes.
//
// The miner stands clear of all three with its travel and drill held, so nothing is
// cut, nothing detonates, and no other effect is playing over any of them.

import { afterEach, beforeEach, it } from "vitest";
import { GAS_SEEP_PERIOD, PLAYABLE_COL_MIN, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  cellCenter,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  ticks,
  worldToStage,
  type Harness,
} from "../harness";
import { peaksNear } from "./effects";

/** A rockbed row, the shallowest band `specs/world.md` puts gas in. */
const ROW = 200;
const MINER_COL = PLAYABLE_COL_MIN + 2;

/** Three pockets, spread across the view and clear of the miner. */
const POCKET_COLS = [MINER_COL + 3, MINER_COL + 5, MINER_COL + 7];

/** Frames the baseline is taken over. */
const BASELINE_FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wisps over each visible pocket inside one seep period", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW + 1);
  standOn(h, MINER_COL, ROW + 1);
  pinMiner(h);
  for (const col of POCKET_COLS) h.debug.setTile(col, ROW, "rock");
  await h.advance(2);

  const snapshot = h.snapshot();
  const points = POCKET_COLS.map((col) => {
    const centre = cellCenter(col, ROW);
    return worldToStage(snapshot, centre.x, centre.y);
  });

  const rock = await peaksNear(h, BASELINE_FRAMES, TILE, points);

  // One seep period is exactly `ticks(GAS_SEEP_PERIOD)` frames of the harness
  // clock, so the watch covers the window the specification names.
  const period = ticks(GAS_SEEP_PERIOD);
  const gas = await captureReplay(h, "seep", async () => {
    for (const col of POCKET_COLS) h.debug.setTile(col, ROW, "gas");
    await h.advance(period);
    return peaksNear(h, period, TILE, points);
  });

  const quiet = gas.flatMap((peak, at) =>
    peak <= rock[at] ? [POCKET_COLS[at]] : [],
  );

  assertEqual(quiet.join(", "), "", "specs/hazards.md");
});

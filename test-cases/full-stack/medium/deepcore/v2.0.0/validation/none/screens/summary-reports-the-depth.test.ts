// screens/summary-reports-the-depth — the summary reports how deep the expedition got.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `deepestDepthMeters` alone.
//
// THE FIGURE COMES FROM specs/world.md, not from the summary: a miner whose feet
// rest at the top of row `r` is at `METERS_PER_ROW * (r - 1)` meters, so the row
// the miner is taken to fixes what the summary has to say.
//
// THE SCENE IS REACHED THROUGH THE SURFACE ALONE, so nothing here presses a menu
// key: a build with a broken size-select confirm fails the checks that own that
// transition and this one still reads the summary.
//
// ISOLATION. One expedition, with the miner's body gated so it holds where it was
// put and its drill gated so nothing is cut or banked behind the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import { METERS_PER_ROW } from "../constants";
import {
  captureStill,
  createHarness,
  minerXOn,
  minerYOn,
  openExpedition,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { driveDeath } from "../save/expedition";

/** The mode the expedition is played in, which is not the session default. */
const MODE = "hardcore" as const;

/** The row the miner is taken to, and the depth specs/world.md gives its top. */
const DEEP_COL = 12;
const DEEP_ROW = 120;
const DEEPEST_METERS = METERS_PER_ROW * (DEEP_ROW - 1);

/** Half a meter: the depth is an exact expression of the miner's feet. */
const DEPTH_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the deepest depth the expedition reached", async () => {
  await h.debug.clearSave();
  await openExpedition(h, { mode: MODE });
  await pinMiner(h);
  await pinDrill(h);

  await h.debug.setMinerPosition(minerXOn(DEEP_COL), minerYOn(DEEP_ROW));
  await h.debug.setMinerVelocity(0, 0);
  // One frame, so the deepest depth follows the position that was just posed.
  await h.advance(1);

  const over = await driveDeath(h, "hull-destroyed");
  await captureStill(h, "depth");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  assertBetween(
    over.summary?.deepestDepthMeters ?? Number.NaN,
    DEEPEST_METERS - DEPTH_TOLERANCE,
    DEEPEST_METERS + DEPTH_TOLERANCE,
    "specs/expedition.md: the summary reports the deepest depth reached in meters",
  );
});

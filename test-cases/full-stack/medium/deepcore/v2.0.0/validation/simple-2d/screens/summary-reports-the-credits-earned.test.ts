// screens/summary-reports-the-credits-earned — the summary reports what the expedition earned.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `creditsEarned` alone.
//
// THE FIGURE COMES FROM specs/mining.md's ore values: four units of Ferron sold
// at the Ore Market are worth four times what that file prices one at, and that
// product is what the summary has to report.
//
// THE SCENE IS REACHED THROUGH THE SURFACE ALONE, so nothing here presses a menu
// key: a build with a broken size-select confirm fails the checks that own that
// transition and this one still reads the summary.
//
// ISOLATION. One expedition, with the miner's body gated so it holds where it was
// put and its drill gated so nothing is cut or banked behind the reading.

import { afterEach, beforeEach, it } from "vitest";
import { type OreId } from "../constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  mineralOf,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  type Harness,
} from "../harness";
import { driveDeath } from "./expedition";

/** The mode the expedition is played in, which is not the session default. */
const MODE = "hardcore" as const;

/** The cargo that is sold, and what specs/mining.md says it is worth. */
const SOLD_ORE: OreId = "ferron";
const SOLD_UNITS = 4;
const EARNED = SOLD_UNITS * mineralOf(SOLD_ORE).value;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the total Credits the expedition earned", async () => {
  openScene(h, { mode: MODE });
  h.debug.clearSave();
  pinMiner(h);
  pinDrill(h);

  stageCargo(h, { [SOLD_ORE]: SOLD_UNITS });
  h.debug.sell();

  const over = await driveDeath(h, "hull-destroyed");
  captureStill(h, "earned");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  assertEqual(
    over.summary?.creditsEarned,
    EARNED,
    `specs/expedition.md: the summary reports the total Credits earned, ${SOLD_UNITS} ${SOLD_ORE} at ${mineralOf(SOLD_ORE).value}`,
  );
});

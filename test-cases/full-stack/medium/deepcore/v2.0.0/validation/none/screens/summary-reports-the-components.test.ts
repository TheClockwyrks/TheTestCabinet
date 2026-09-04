// screens/summary-reports-the-components — the summary reports how much of the rocket was built.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `componentsInstalled` alone.
//
// THE FIGURE COMES FROM THE CHECKLIST. Three of the five components are installed
// through `setRocketInstalled`, which specs/instrumentation.md says costs no
// Credits and consumes no material, so what the summary reports is a statement
// about the rocket rather than about a purchase.
//
// THE SCENE IS REACHED THROUGH THE SURFACE ALONE, so nothing here presses a menu
// key: a build with a broken size-select confirm fails the checks that own that
// transition and this one still reads the summary.
//
// ISOLATION. One expedition, with the miner's body gated so it holds where it was
// put and its drill gated so nothing is cut or banked behind the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openExpedition,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { driveDeath } from "../save/expedition";

/** The mode the expedition is played in, which is not the session default. */
const MODE = "hardcore" as const;

/** The rocket components installed before the run ends, of the five there are. */
const COMPONENTS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports how many rocket components were installed", async () => {
  await h.debug.clearSave();
  await openExpedition(h, { mode: MODE });
  await pinMiner(h);
  await pinDrill(h);

  await h.debug.setRocketInstalled(COMPONENTS);

  const over = await driveDeath(h, "hull-destroyed");
  await captureStill(h, "rocket");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  assertEqual(
    over.summary?.componentsInstalled,
    COMPONENTS,
    "specs/expedition.md: the summary reports the number of rocket components installed",
  );
});

// screens/summary-reports-the-mode — the summary reports which mode was played.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `mode` alone.
//
// THE FIGURE COMES FROM THE OPENING. The expedition is opened in Hardcore, which
// is not the mode a session opens at, so a build that reported a default rather
// than what was played fails.
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
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { driveDeath } from "./expedition";

/** The mode the expedition is played in, which is not the session default. */
const MODE = "hardcore" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the mode the expedition was played in", async () => {
  openScene(h, { mode: MODE });
  h.debug.clearSave();
  pinMiner(h);
  pinDrill(h);

  const over = await driveDeath(h, "hull-destroyed");
  captureStill(h, "mode");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  assertEqual(
    over.summary?.mode,
    MODE,
    "specs/expedition.md: the summary reports the mode the expedition was played in",
  );
});

// screens/summary-reports-the-elapsed-time — the summary reports how long the expedition ran.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `elapsedSeconds` alone.
//
// THE CLOCK IS POSED AND THEN LEFT RUNNING. specs/instrumentation.md's
// `setElapsed(seconds)` puts the expedition clock at a figure no expedition
// reaches by accident, and specs/expedition.md has the clock keep accumulating
// afterwards — so the summary reads at least the posed figure and no more than
// the stretch that followed it. A build that reported a fresh zero fails on the
// floor, and one that reported some total of its own fails on the ceiling.
//
// THE SCENE IS REACHED THROUGH THE SURFACE ALONE, so nothing here presses a menu
// key: a build with a broken size-select confirm fails the checks that own that
// transition and this one still reads the summary.
//
// ISOLATION. One expedition, with the miner's body gated so it holds where it was
// put and its drill gated so nothing is cut or banked behind the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
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

/** The expedition clock the summary is read against, posed rather than waited out. */
const POSED_SECONDS = 300;

/**
 * How much longer than the posed figure the summary may read.
 *
 * The clock keeps running while the death plays out, and how long a build plays
 * one out before it shows the summary is the build's; the ceiling covers that
 * stretch with room to spare.
 */
const ELAPSED_SLACK = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the elapsed time the expedition ran for", async () => {
  await h.debug.clearSave();
  await openExpedition(h, { mode: MODE });
  await pinMiner(h);
  await pinDrill(h);

  await h.debug.setElapsed(POSED_SECONDS);

  const over = await driveDeath(h, "hull-destroyed");
  await captureStill(h, "elapsed");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  assertBetween(
    over.summary?.elapsedSeconds ?? Number.NaN,
    POSED_SECONDS,
    POSED_SECONDS + ELAPSED_SLACK,
    "specs/expedition.md: the summary reports the elapsed time",
  );
});

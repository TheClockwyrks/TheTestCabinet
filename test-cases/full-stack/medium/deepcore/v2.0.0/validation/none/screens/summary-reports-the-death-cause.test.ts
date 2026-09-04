// screens/summary-reports-the-death-cause — the game-over summary reports how the miner died.
//
// specs/expedition.md: "The game keeps no running total. The Victory and Game
// Over screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// SIX FIELDS, SIX POINTS. Each names a separate thing the expedition did, so a
// build that reports five of them and drops one must grade differently from one
// that reports none. This point decides `deathCause` alone, which is the one field that exists only on a Game Over.
//
// TWO DEATHS, ONE RULE. The cause is read after a hull destroyed and again after
// a tank run dry on a fresh expedition, which is the same requirement exercised
// the same way twice: a build that names one cause whatever happened is what the
// second reading catches, and neither cause is a different requirement from the
// other. Which deaths the game HAS is specs/modes.md's own point,
// `screens/game-over-screen`.
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
  type DeathCause,
  type Harness,
} from "../harness";
import { driveDeath } from "../save/expedition";

/** The mode the expedition is played in, which is not the session default. */
const MODE = "hardcore" as const;

/** The two deaths the cause is read after, in the order they are driven. */
const CAUSES: readonly DeathCause[] = ["hull-destroyed", "fuel-out"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports how the miner died, on each of two deaths", async () => {
  const reported: (DeathCause | null | undefined)[] = [];
  for (const cause of CAUSES) {
    await h.debug.clearSave();
    await openExpedition(h, { mode: MODE });
    await pinMiner(h);
    await pinDrill(h);

    const over = await driveDeath(h, cause);
    assertNotNull(
      over.summary,
      `specs/ui.md: the Game Over screen shows the expedition summary, after a ${cause}`,
    );
    reported.push(over.summary?.deathCause);
  }
  await captureStill(h, "cause");

  for (const [index, cause] of CAUSES.entries()) {
    assertEqual(
      reported[index],
      cause,
      `specs/expedition.md: the summary reports how the miner died, after a ${cause}`,
    );
  }
});

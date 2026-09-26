// screens/game-over-screen — every death ends at the Game Over screen with a
// summary.
//
// specs/modes.md: "In both modes a death ends the expedition at the Game Over
// screen", and a death is any of three things — fuel reaching `0` below the
// surface ground line (`fuel-out`), the hull standing at `0`
// (`hull-destroyed`), or the Core Sample's timer expiring while it is carried
// (`core-detonation`). specs/ui.md: the `game-over` screen shows "The expedition
// summary, after a death", and specs/expedition.md fixes the summary as `null`
// until the expedition ends.
//
// SO ALL THREE CAUSES ARE DRIVEN, each in a fresh expedition, and each is read
// three ways: the screen is `game-over`, the summary is there, and it names the
// cause that ended the run. A build that handled one death and not another is
// caught on the one it missed.
//
// NOTHING HERE POSES THE OUTCOME. Each cause is arranged as the condition the
// specification states and the game's own continuous check is what acts on it,
// which specs/instrumentation.md says explicitly of `setHull(0)`: "A hull posed
// to `0` is not itself a death: the game's own continuous check is what ends the
// expedition, on the next update."
//
// ISOLATION. An empty mine per cause with the slot cleared, and the miner's body
// and drill gated, since no death here is about either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { type DeathCause } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveDeath, openAtCamp } from "../save/expedition";

/** The three deaths specs/modes.md names, by the id it gives each. */
const CAUSES: readonly DeathCause[] = [
  "fuel-out",
  "hull-destroyed",
  "core-detonation",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends at the Game Over screen with a summary, whichever death it was", async () => {
  for (const cause of CAUSES) {
    await openAtCamp(h);
    const over = await driveDeath(h, cause);
    if (cause === "hull-destroyed") await captureStill(h, "over");

    assertEqual(
      over.screen,
      "game-over",
      `specs/modes.md: a ${cause} death ends the expedition at the Game Over screen`,
    );
    assertNotNull(
      over.summary,
      `specs/ui.md: the Game Over screen shows the expedition summary after a ${cause} death`,
    );
    assertEqual(
      over.summary?.deathCause,
      cause,
      `specs/expedition.md: the summary names how the miner died`,
    );
  }
});

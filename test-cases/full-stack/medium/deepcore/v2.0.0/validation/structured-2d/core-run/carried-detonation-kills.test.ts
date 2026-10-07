// Deepcore — core-run/carried-detonation-kills: the timer running out on a
// carried Sample kills the miner.
//
// `specs/hazards.md`: "A detonation while the Sample is carried kills the miner
// outright." `specs/modes.md` names the cause: "The Core Sample's timer expiring
// while it is carried ... `core-detonation`", and a death "ends the expedition at
// the Game Over screen".
//
// The Sample is posed carried with a short timer and the hull left FULL, which is
// what makes the reading say "outright": a miner at full hull cannot have died of
// anything else, and the summary's cause is read to say so. The game is then run
// on until it leaves `in-mine`, so it is the game's own timer and its own death
// check that end the expedition rather than anything posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { openCampScene, runUntilOver } from "./core-scene";

/** Short enough to run out inside the drive, long enough not to be instant. */
const SHORT_TIMER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("kills the miner outright when a carried Sample's timer runs out", async () => {
  openCampScene(h);
  const { miner } = h.snapshot();
  h.debug.setHull(miner.maxHull);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(SHORT_TIMER);

  const over = await captureReplay(h, "detonation", () => runUntilOver(h));

  assertEqual(
    over.screen,
    "game-over",
    "the screen the detonation left the game on",
  );
  assertNotNull(over.summary, "an expedition summary after the detonation");
  assertEqual(
    over.summary?.deathCause,
    "core-detonation",
    "the cause the summary reports",
  );
});

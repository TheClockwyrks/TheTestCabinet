// Deepcore — core-run/death-destroys-the-sample: a death takes the Sample with
// the miner.
//
// `specs/hazards.md`: the Sample "is destroyed either way, and by any death while
// it is held." `specs/modes.md` says the same of every death: it "destroys a Core
// Sample held or ticking on the ground."
//
// A Sample is posed carried with plenty of time left on it, and the miner is then
// killed by something else entirely: the hull is posed at `0`, which
// `specs/instrumentation.md` says "is not itself a death: the game's own
// continuous check is what ends the expedition, on the next update". So the game
// kills the miner by its own rule, and the summary's cause is read as
// `hull-destroyed` to say the Sample's own timer had nothing to do with it.
//
// Afterwards the satchel must be empty and the timer gone.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { openCampScene, runUntilOver } from "./core-scene";

/** Far more time than the drive takes, so the timer cannot be what killed it. */
const POSED_TIMER = CORE_TIMER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a carried Sample when the miner dies of something else", async () => {
  openCampScene(h);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(POSED_TIMER);
  h.debug.setHull(0);

  const over = await captureReplay(h, "gone", () => runUntilOver(h));

  assertEqual(
    over.screen,
    "game-over",
    "the screen the death left the game on",
  );
  assertEqual(
    over.summary?.deathCause,
    "hull-destroyed",
    "the cause the summary reports",
  );
  assertEqual(
    over.satchel.coreSample,
    false,
    "a Sample still held after the death",
  );
  assertNull(over.coreTimer, "a timer still running after the death");
});

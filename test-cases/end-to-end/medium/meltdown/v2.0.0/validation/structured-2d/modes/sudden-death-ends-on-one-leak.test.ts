// Meltdown — modes/sudden-death-ends-on-one-leak: one Mote through the exhaust
// ends a Sudden Death run.
//
// THE RULE. `specs/modes.md`, Sudden Death: it "opens on `1` life, so a single
// leak of any unit takes the lives to `0` and ends the run." `specs/surge.md`
// gives a Mote a leak value of `1` life, and `specs/waves.md` fixes the
// consequence: "Lives reaching `0` ends the run at once, on the frame it happens
// and whatever the phase, and opens the game-over screen."
//
// THE LEAK IS WALKED, NOT POSED. `specs/instrumentation.md` is explicit that
// `setLives` "triggers no game over: the loss belongs to the leak path, and this
// is a precondition", so the only way to reach this transition is to let a unit
// reach its exhaust. A Mote is posed one tile short of the right exhaust and
// walks out under its own power (`modes/ending.ts`); the run's lives are left
// exactly where the mode put them, so what ends the run is the mode's own figure
// meeting the Mote's own leak value.
//
// THE MOTE IS THE UNIT THE ITEM NAMES, AND IT IS THE HARDEST CASE. Its leak value
// of `1` is the smallest in the game — a Hulk costs `2` and a Core `5` — so a
// build that survives any leak survives this one, and a build whose Sudden Death
// life count is right but whose leak accounting is off by one reads `1` life
// remaining rather than `0`.
//
// THE WAVE MUST NOT CLEAR UNDER THE READING, which is why `wavePending` is posed
// at `1`. `specs/waves.md` clears a wave when its last live unit goes "with none
// of it left to release", and a clear on this frame would pay a bonus, advance
// the wave and open a build phase alongside the loss — two transitions at once,
// and a reading that could no longer say which one produced the screen. With one
// unit still owed and the world gate off (nothing is ever released), the leak is
// the only transition in the window.
//
// TWO READINGS, ONE REQUIREMENT: the lives reach `0`, and the game-over screen is
// what the run ends on. A build that zeroes the lives and leaves the player on
// the floor, or that ends the run while still reporting a life in hand, fails on
// the reading it got wrong. Neither carries a tolerance: lives are whole and a
// screen is a name.
//
// WHAT EVERY WRONG MODEL READS. A build that gave Sudden Death the standard
// twenty lives reads `19` and `playing`; one that ends the run at one life
// remaining rather than at none reads `0` early elsewhere and `gameover` here for
// the wrong reason, which `waves.game-over-at-zero-lives` is what separates; one
// that charges no life for a leak reads `1` and `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { SUDDEN_DEATH_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./ending";

/** The mode this point reads. */
const MODE = "suddendeath";

/** The wave the leak happens on: an ordinary wave, well short of the run's last. */
const WAVE = 1;

/**
 * Units still owed while the leak happens, so the wave cannot clear on the same
 * frame. The world gate is off, so none of them is ever released.
 */
const STILL_OWED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the lives to zero and opens the game-over screen on one leak", async () => {
  startRun(h, MODE);
  h.debug.setWave(WAVE);
  h.debug.setPhase("wave");
  h.debug.setWavePending(STILL_OWED);
  poseLeaker(h);

  const before = h.snapshot();
  assertEqual(before.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    before.lives,
    SUDDEN_DEATH_LIVES,
    "precondition: the lives the run is posed with",
  );
  assertEqual(before.surge.length, 1, "precondition: the units on the floor");

  const gone = await runUntilLeaked(h);
  captureStill(h, "gameover");

  assertTrue(gone, "precondition: the Mote left the floor through its exhaust");
  const after = h.snapshot();
  assertEqual(after.lives, 0, "the lives left after one Mote leaked");
  assertEqual(
    after.screen,
    "gameover",
    "the screen a Sudden Death run ends on after one leak",
  );
});

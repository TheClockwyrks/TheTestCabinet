// modes/sudden-death-ends-on-one-leak — one leak ends a Sudden Death run.
//
// THE RULE. specs/modes.md, Sudden Death: "Sudden Death opens on `1` life, so a
// single leak of any unit takes the lives to `0` and ends the run."
// specs/waves.md gives the ending: "Lives reaching `0` ends the run at once, on the
// frame it happens and whatever the phase, and opens the game-over screen."
// specs/surge.md costs a Mote's leak `1` life, so on this mode one Mote is the whole
// margin.
//
// THE ENDING IS REACHED, NOT POSED. specs/instrumentation.md has `setScreen` run "no
// screen entry effect" and `setLives` "trigger no game over: this is a precondition"
// — so a build could pass a posed reading while its leak ended nothing. The run is
// posed at the shape a leak happens from and the leak is the game's own: one Mote
// walking under its own power with a single tile left to its exhaust (modes/run.ts).
//
// THE LIVES ARE THE MODE'S OWN, NOT A NUMBER THIS POINT CHOSE. `startRun` opens the
// run on the figure specs/modes.md derives for Sudden Death, which is `1`; nothing
// here poses a life count, so what the leak is measured against is the mode.
//
// NOTHING ELSE CAN END THIS RUN, and the posing is what guarantees it.
// specs/waves.md also ends a run when the final wave clears, and a clear happens
// only "with none of it left to release" — so `wavePending` is posed at `1`, with
// `startRun`'s world gate still shut so that unit never arrives. The wave therefore
// cannot clear, no victory or clear transition can fire, and the only transition left
// in the scenario is the leak. That is what makes the game-over screen below
// attributable to it.
//
// TWO READINGS, ONE PER CLAUSE. Takes the lives to `0`: the life count after the
// leak, which is the figure a Mote's leak of `1` removes from the mode's `1`. And
// shows the game-over screen: the screen. A build whose leak costs the right life and
// leaves the run open fails the second alone, and one that ends the run without
// spending the life fails the first.
//
// WHAT THIS POINT DOES NOT DECIDE. That a leak costs a life at all is
// `surge.leak-costs-a-life`, and that zero lives ends any run is
// `waves.game-over-at-zero-lives`; both are read on Containment, where twenty lives
// make a single leak survivable. What is Sudden Death's own is that ONE is enough.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./run";

/** The mode this point is about. */
const MODE = "suddendeath";

/** The wave the run is posed on: its first, so nothing about the run is late. */
const WAVE = 1;

/**
 * The units still queued for release: one.
 *
 * Not zero, which would let the leak CLEAR the wave as well as end the run, and put
 * two transitions inside one reading. `startRun` leaves the world gate shut, so the
 * queued unit never arrives (specs/instrumentation.md).
 */
const PENDING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run on the game-over screen when a single Mote reaches its exhaust", async () => {
  startRun(h, MODE);
  h.debug.setWave(WAVE);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);
  poseLeaker(h);

  const opened = h.snapshot();
  const leaked = await runUntilLeaked(h);
  captureStill(h, "gameover");

  assertEqual(
    opened.lives,
    1,
    "posing: the lives a Sudden Death run opens on (specs/modes.md, Sudden Death)",
  );
  assertTrue(
    leaked,
    "precondition: the Mote reached its exhaust and left the floor",
  );

  const after = h.snapshot();
  assertEqual(
    after.lives,
    0,
    "the lives left after one Mote leaked on Sudden Death, a leak costing one " +
      "and the mode opening on one (specs/modes.md, Sudden Death; specs/surge.md)",
  );
  assertEqual(
    after.screen,
    "gameover",
    "the screen a Sudden Death run is on once its single life is gone " +
      "(specs/modes.md, Sudden Death; specs/waves.md, Victory and loss)",
  );
});

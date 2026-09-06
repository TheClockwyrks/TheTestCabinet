// instrumentation/clock-switch-holds-the-simulation — with the wall clock held off
// the simulation, real time changes nothing, and the game moves only when the
// clock is stepped.
//
// THE RULE. "Render-free core. Game state advances from the elapsed time the game
// is handed, independent of a canvas, of the frame loop that measured it, and of
// wall-clock time" (`specs/instrumentation.md`, A render-free core). Under no
// engine the switch that does the holding is the surface's own: "`setAutoStep(false)`
// stops the frame loop advancing the simulation from the wall clock, so the game
// changes only when `advance` says so. `setAutoStep(true)` returns it to running
// itself, which is how a build starts and how it is played. It changes no game
// state." Under either engine the same hold is the engine's stepped clock, which
// "advances the game frame by frame and can take it off real time".
//
// SO THE CHECK DRIVES THE HOLD ITSELF, not the switch's spelling. Each project's
// harness holds its build's clock the way its engine's specification says to, and
// the three readings below are the same reading in all three: real time passing
// changes nothing, a stepped frame changes something, the game handed back to its
// own loop advances by itself, and taking it back holds it again.
//
// THE MACHINE IS RUNNING AND LOADED WITH WORK. A run stopped, paused or empty
// stands still under any clock at all, so the world posed here is the shortest
// complete carrying cycle with a mote in its gripper, at the default speed, mid
// flight: the thing most likely to drift on if the wall clock still reached it.
//
// WHAT IS READ AS "STOOD STILL" is every figure the run advances: `sim.cycle`, and
// `sim.fraction` and `simTime`, which are read near because the specification
// carries them as running sums. A build that integrated the wall clock would show
// it in the fraction long before the cycle.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { BARE, CARRY_MACHINE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Real milliseconds of wall clock the held game is left alone for. */
const WAITED_MS = 400;

/** How far the run has got: whole cycles plus the fraction of the one in flight. */
function progress(snapshot: OrrerySnapshot): number {
  const sim = snapshot.sim;
  return (sim?.cycle ?? -1) + (sim?.fraction ?? 0);
}

/** Let real time pass, with no frame driven and nothing asked of the game. */
function waitRealTime(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands still across real time while held, and moves when the clock is stepped", async () => {
  await openBareRun(h, { challenge: BARE, machine: CARRY_MACHINE });
  await spawnMote(h, at(1, 0), "sol");
  await advanceFraction(h, 0.5);

  const held = await h.snapshot();
  assertNotNull(
    held.sim,
    "the run is live, and part way through its first cycle",
  );
  assertEqual(
    held.sim?.status,
    "running",
    "and it is running rather than paused",
  );

  // One capture over the whole demonstration, so the evidence holds the frames
  // that moved the run as well as the stretches of real time that did not.
  const measured = await captureReplay(h, "held", async () => {
    await waitRealTime(WAITED_MS);
    const waited = await h.snapshot();
    await advanceFraction(h, 0.25);
    const stepped = await h.snapshot();
    await h.runFor(WAITED_MS);
    const ran = await h.snapshot();
    await waitRealTime(WAITED_MS);
    const heldAgain = await h.snapshot();
    return { waited, stepped, ran, heldAgain };
  });

  const { waited, stepped, ran, heldAgain } = measured;
  assertEqual(
    waited.sim?.cycle,
    held.sim?.cycle,
    "the wall clock is held off the simulation, so no cycle ran over real time",
  );
  assertNear(
    waited.sim?.fraction ?? -1,
    held.sim?.fraction ?? -2,
    FRACTION_TOLERANCE,
    "and the fraction stood exactly where the last stepped frame left it",
  );
  assertNear(
    waited.simTime,
    held.simTime,
    FRACTION_TOLERANCE,
    "and no update ran, so simTime added nothing",
  );

  // It moves when, and only when, the clock says so.
  assertGreaterThan(
    progress(stepped),
    progress(waited),
    "a stepped frame advances the run: the game changes when the clock says so",
  );

  // Handed back to its own loop, the game runs itself.
  assertGreaterThan(
    progress(ran),
    progress(stepped),
    "given back to its own frame loop, the game advances from real time by itself",
  );

  // And taking it back holds it again.
  assertEqual(
    heldAgain.sim?.cycle,
    ran.sim?.cycle,
    "taken off real time again, no further cycle runs over real time",
  );
  assertNear(
    heldAgain.sim?.fraction ?? -1,
    ran.sim?.fraction ?? -2,
    FRACTION_TOLERANCE,
    "and the fraction stands still again",
  );
});

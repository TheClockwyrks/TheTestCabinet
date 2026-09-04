// extras/reference-solves-aetherfall — the reference solution for Extras 8 runs
// Aetherfall to completion.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge"
// (`specs/modes/extras.md`, The shelf), and that requirement is that the
// challenge "is solvable: the build ships a reference solution for it, in the
// solution format, that is legal, places every rise and set, and whose run
// completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of
// the run's start" (`specs/modes/campaign.md`, The course).
//
// WHAT COMPLETING IS. "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes: the status becomes `complete` and the
// metrics are recorded" (`specs/simulation.md`, Completion and metrics). The
// target is the challenge's own, and `specs/challenges.md` writes it as `6` for
// every Extra, which is `CONSTELLATION_TARGET`.
//
// WHAT THE MACHINE HAS TO DO. Aetherfall is the only Extra with FOUR reagents —
// `nebula`, `comet`, `nova` and `meteor`, each its own rise — fused into one
// `aether` by a `confluence`. So its machine has to feed four sources and time
// them against ONE shared period, which is the pressure `specs/modes/campaign.md`
// calls "timing several arms against one shared period". A build whose reference
// answers the one-reagent Extras and stalls on this one is what this point
// catches: the four reagents are read off the open challenge before the run, so
// the world the machine is judged in is the four-source one.
//
// THE POSE. The shipped challenge opened through `openChallenge("extras", 7)`,
// its OWN reference solution loaded as the machine through `loadSolution`, and
// the run started through `startRun` — which "skips the readiness condition the
// `play` action applies" (`specs/instrumentation.md`). The completion switch is
// left ON, because completion is exactly what is read. Nothing else is posed: no
// mote is spawned, no pose is moved, no tally is set. The machine is the build's
// own and so is the run.
//
// HOW THE BUDGET IS SPENT. The clock is driven `CAMPAIGN_REFERENCE_CYCLES` cycles
// of game time and no more, in chunks, stopping as soon as the run is no longer
// `running`. So "within 600 cycles" is enforced by the DRIVE rather than by
// reading a metric back afterwards: a run still running when the budget is gone
// has not completed within it, whatever it reports. Each chunk is divided into
// whole frames, and "an interval of game time reaches the same state however it
// was divided into frames" (`specs/instrumentation.md`), so the division decides
// nothing.
//
// THE VERDICT. Within the budget the run reaches `sim.status` `complete` — not
// `faulted`, and not still `running` — with no fault reported, and the tally of
// the challenge's one product has reached its target.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  CAMPAIGN_REFERENCE_CYCLES,
  CONSTELLATION_TARGET,
  FRAMES_PER_CYCLE,
} from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

/** How many cycles of the budget one drive spends before the status is read. */
const CHUNK = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive the live run until it stops being `running`, or until the reference's
 * whole budget of `CAMPAIGN_REFERENCE_CYCLES` cycles has been spent.
 */
async function runWithinTheBudget(): Promise<void> {
  for (let spent = 0; spent < CAMPAIGN_REFERENCE_CYCLES; spent += CHUNK) {
    const sim = (await h.snapshot()).sim;
    if (sim === null || sim.status !== "running") return;
    await advanceCycles(h, CHUNK, CHUNK * FRAMES_PER_CYCLE);
  }
}

/** Which Extra this is, from `0`: challenge 8, Aetherfall. */
const INDEX = 7;

/** How many reagents `specs/challenges.md` writes into Aetherfall. */
const AETHERFALL_REAGENTS = 4;

it("completes Aetherfall with the machine the build itself puts forward", async () => {
  const document = await referenceSolution(h, "extras", INDEX);
  await openChallenge(h, "extras", INDEX);
  const view = (await h.snapshot()).challenge;

  assertNotNull(view, "Extras 8 opens in the editor");
  assertNotNull(document ?? null, "Extras 8 ships a reference solution");
  if (view === null || document === null || document === undefined) return;

  assertLength(
    view.reagents,
    AETHERFALL_REAGENTS,
    "Aetherfall poses four reagents, which is the world the reference machine is run in",
  );

  await loadMachine(h, document);
  await h.debug.startRun();
  await captureReplay(h, "run", () => runWithinTheBudget());

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live when its budget has been spent");
  assertNull(
    sim?.fault ?? null,
    "the reference machine runs Aetherfall without faulting",
  );
  assertEqual(
    sim?.status,
    "complete",
    "the reference machine completes Aetherfall within CAMPAIGN_REFERENCE_CYCLES cycles of the run's start",
  );
  assertEqual(
    view.target,
    CONSTELLATION_TARGET,
    "Aetherfall asks every set for CONSTELLATION_TARGET, as every challenge in this game does",
  );
  assertGreaterThanOrEqual(
    sim?.tallies[0] ?? -1,
    view.target,
    "the set on Aetherfall's one product has reached that target when the run completes",
  );
});

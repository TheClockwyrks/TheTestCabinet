// campaign/reference-solution-never-faults — no reference solution of the course
// faults on its way to completing.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it ... whose run completes WITHOUT FAULTING within
// `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start"
// (`specs/modes/campaign.md`, The course). A fault is the other way a run ends:
// "A fault freezes the run where it stood: the status becomes `faulted` and
// nothing advances further" (`specs/simulation.md`, Faults), and `sim.fault`
// names what raised it.
//
// WHY IT IS A POINT OF ITS OWN. A machine that collides with itself, tears a
// constellation, overextends an arm or walks off a track is not an answer to the
// puzzle even if some other run of it would have completed: the player who
// pressed `play` on it would watch it halt. The requirement is that the reference
// reaches the end CLEANLY.
//
// AND IT IS NOT SATISFIED BY A RUN THAT NEVER MOVED. A machine that does nothing
// raises no fault either, so this check also reads back that the window it
// watched actually closed on a completion: what it decides is that the stretch
// between the run's start and its completion holds no fault, and a stretch that
// never reached a completion is not that stretch.
//
// THE POSE, for each challenge in turn: the shipped challenge opened, its own
// reference solution loaded, the run started through the surface, and the clock
// driven at most `CAMPAIGN_REFERENCE_CYCLES` cycles in chunks. The status and
// `sim.fault` are read after every chunk as well as at the end — a fault freezes
// the run, so a fault raised at any cycle is still standing at the next reading,
// and the sweep cannot miss one.
//
// THE VERDICT, for every challenge of the course: no reading of the run reports a
// `sim.fault` or a `faulted` status, and the run's last reading is `complete`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, FRAMES_PER_CYCLE } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How many cycles of the budget one drive spends before the run is read. */
const CHUNK = 20;

/**
 * How many cycles at the head of a recorded run take the watchable division.
 *
 * The recording opens on the machine moving rather than on a stop-motion of it,
 * and the budget after them runs at a frame a cycle: "a frame may complete
 * several cycles; each runs in full, in order" (`specs/simulation.md`), and "an
 * interval of game time reaches the same state however it was divided into
 * frames" (`specs/instrumentation.md`). A run no recording is taken of is driven
 * at a frame a cycle throughout.
 */
const WATCHED_CYCLES = 2;

/**
 * Drive the live run until it stops being `running`, or until the reference's
 * whole budget is spent, answering every fault the readings caught on the way.
 */
async function faultsWithinTheBudget(
  h: Harness,
  watched: number,
): Promise<string[]> {
  const seen: string[] = [];
  let spent = 0;
  if (watched > 0) {
    await advanceCycles(h, watched, watched * FRAMES_PER_CYCLE);
    spent = watched;
  }
  for (;;) {
    const sim = (await h.snapshot()).sim;
    if (sim === null) return seen;
    if (sim.fault !== null) seen.push(sim.fault.kind);
    else if (sim.status === "faulted") seen.push("faulted");
    if (sim.status !== "running") return seen;
    if (spent >= CAMPAIGN_REFERENCE_CYCLES) return seen;
    const run = Math.min(CHUNK, CAMPAIGN_REFERENCE_CYCLES - spent);
    await advanceCycles(h, run, run);
    spent += run;
  }
}

it("reaches completion without a fault on every challenge of the course", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    const document = await referenceSolution(h, "campaign", index);
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    assertNotNull(
      document ?? null,
      `campaign challenge ${index + 1} ships a reference solution`,
    );
    if (view === null || document === null) return;

    await loadMachine(h, document);
    await h.debug.startRun();

    // The opener's run is the recorded one, so the evidence is there whichever
    // challenge of the course turns out to fault.
    const faults =
      index === 0
        ? await captureReplay(h, "clean-run", () =>
            faultsWithinTheBudget(h, WATCHED_CYCLES),
          )
        : await faultsWithinTheBudget(h, 0);

    const at = `campaign challenge ${index + 1}`;
    assertDeepEqual(
      faults,
      [],
      `${at}'s reference run raises no fault at any cycle between its start and its completion`,
    );

    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `${at}'s run is still live after its budget`);
    assertEqual(
      sim?.status,
      "complete",
      `${at}'s reference run reached a completion, so the fault-free stretch just read is the stretch from the run's start to it`,
    );
  }
});

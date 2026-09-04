// extras/cost-record-takes-the-lower — a cheaper completion lowers the cost
// record.
//
// THE RULE. "Each challenge keeps its records: the LOWEST `cost`, the lowest
// `cycles`, and the lowest `area` over the session's completed runs of it, each
// metric independently" (`specs/modes/campaign.md`, Progression), which
// `specs/modes/extras.md` adopts word for word: "each challenge keeps its records
// as `specs/modes/campaign.md` states". The lowest over the session's runs: a
// completion cheaper than the one standing takes the record. `cost` is "The
// machine's cost, as `specs/parts.md` computes it" (`specs/simulation.md`,
// Completion and metrics).
//
// THE TWO RUNS DIFFER BY ONE ARM AND NOTHING ELSE. The dearer run goes first, on
// the build's own reference solution with one more arm on it; the cheaper run
// follows on the reference alone. "A machine's cost is the sum of its placed
// parts' costs" (`specs/parts.md`), so the second machine costs exactly
// `PART_COSTS.arm` less than the first — a real second completion of the same
// challenge rather than a record posed through the surface, which is what makes
// the point about what a COMPLETION does to a record.
//
// THE VERDICT. The two runs' own `sim.metrics.cost` figures confirm the second was
// the cheaper, and `extras.records[0].cost` is the second run's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLessThan } from "../assert";
import {
  ARM_MIN_LEN,
  CAMPAIGN_REFERENCE_CYCLES,
  PART_COSTS,
  SPEEDS,
} from "../constants";
import { fieldHexes } from "../field";
import { armPart, solution, type Solution } from "../formats";
import { isAnchored } from "../parts";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  openSelect,
  referenceSolution,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Extras 1, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 0;

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: it is how few frames the reference's cycle budget costs.
 */
const FAST_SPEED = SPEEDS.length - 1;

/**
 * How many cycles one call to the clock covers. The budget is walked in steps
 * rather than in one span so a run that finishes early costs the frames it needed;
 * "the span is the same however it is divided" (`specs/instrumentation.md`), so
 * nothing the run decides turns on this figure.
 */
const CYCLES_PER_STEP = 25;

/**
 * Open a SHIPPED Extras challenge on `machine`, completion allowed, and start it.
 *
 * `openChallenge` is what makes this the shelf's own challenge rather than a
 * document: "The snapshot reports it under that `mode` and `index`"
 * (`specs/instrumentation.md`), where `loadChallenge` "reports its `source` as
 * `"custom"`" and "Completing a challenge whose source is `"custom"` touches no
 * progress and no record". This point is about progress, so it opens the
 * challenge this way.
 */
async function startExtrasRun(index: number, machine: Solution): Promise<void> {
  await openChallenge(h, "extras", index);
  await loadMachine(h, machine);
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
}

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, CYCLES_PER_STEP);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

/**
 * Complete a shipped Extras challenge on `machine`, and answer the finished run.
 *
 * The completion itself is a posing step here rather than a verdict: every Extras
 * challenge "ships a reference solution under the requirement
 * `specs/modes/campaign.md` states for a course challenge"
 * (`specs/modes/extras.md`), which is one "whose run completes without faulting
 * within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start" — so a
 * build whose reference never completes leaves this point's world unposed, which
 * fails it.
 */
async function complete(
  index: number,
  machine: Solution,
): Promise<OrrerySnapshot> {
  await startExtrasRun(index, machine);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `Extras challenge ${index + 1} completes within CAMPAIGN_REFERENCE_CYCLES ` +
      `(${CAMPAIGN_REFERENCE_CYCLES}) cycles on the machine this point runs, ` +
      "which is the world it decides in",
  );
  return finished;
}

/**
 * `machine` with one more arm on it, anchored on a hex no arm or wheel holds.
 *
 * THE LEVER A COST POINT NEEDS IS A MACHINE THAT COSTS MORE AND RUNS THE SAME.
 * "A machine's cost is the sum of its placed parts' costs" (`specs/parts.md`,
 * Costs), so one more arm is exactly `PART_COSTS.arm` more cost. It changes
 * nothing else the run does:
 *
 * - It cannot be refused. Rule 1 asks only that "an arm or wheel's anchor" be on
 *   the field, and rule 4 that "No two arms or wheels share an anchor hex" — the
 *   anchor chosen below is a field hex no anchored part holds. Rule 4 also states
 *   that an anchor "may sit on any sigil footprint hex, a rise's and a set's
 *   included, or on a track cell", so no footprint can be in the way.
 * - It cannot move. Its tape is empty, and the machine's period is "the largest
 *   tape length across its arms and wheels" (`specs/instructions.md`), which an
 *   empty tape leaves alone. A part that fetches nothing performs nothing.
 * - It cannot collide or hold. "Only motes collide, so a gripper and the drawn arm
 *   between base and gripper pass over any hex, on or off the field, and over any
 *   part" (`specs/parts.md`), and a gripper takes hold only on `grab`.
 *
 * What it does reach is `sim.area`, which banks "every hex of every placed part"
 * and "every gripper hex at rest" — so the arm never LOWERS the area of a run,
 * which is what the readings below lean on.
 */
function withOneMoreArm(machine: Solution): Solution {
  const anchored = machine.parts
    .filter((part) => isAnchored(part.kind))
    .map((part) => `${part.q ?? 0},${part.r ?? 0}`);
  const free = fieldHexes().find(
    (hex) => !anchored.includes(`${hex.q},${hex.r}`),
  );
  assertDefined(
    free,
    "the field's ninety-one hexes hold one no arm or wheel is anchored on, " +
      "which is where the arm that makes this machine cost more goes",
  );
  return solution([
    ...machine.parts,
    armPart("arm", free?.q ?? 0, free?.r ?? 0, 0, ARM_MIN_LEN, []),
  ]);
}

it("replaces the cost record when a cheaper run completes the Extra", async () => {
  await h.debug.reset();
  const machine = await referenceSolution(h, "extras", INDEX);

  const dearer = await complete(INDEX, withOneMoreArm(machine));
  const dearerCost = dearer.sim?.metrics?.cost ?? -1;
  assertEqual(
    (await h.snapshot()).extras.records[INDEX]?.cost,
    dearerCost,
    "the first completion is the record the cheaper run has to beat",
  );

  const cheaper = await complete(INDEX, machine);

  await openSelect(h, "extras");
  await captureStill(h, "lowered");

  const cheaperCost = cheaper.sim?.metrics?.cost ?? -1;
  assertLessThan(
    cheaperCost,
    dearerCost,
    "the second machine is the first without one arm, so it costs PART_COSTS.arm " +
      `(${PART_COSTS.arm}) less and its completion is the cheaper run`,
  );
  assertEqual(
    (await h.snapshot()).extras.records[INDEX]?.cost,
    cheaperCost,
    "the challenge keeps the LOWEST cost over the session's completed runs, so " +
      "the cheaper run's cost replaces the record",
  );
});

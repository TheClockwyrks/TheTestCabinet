// extras/cycles-record-takes-the-lower — a shorter completion lowers the cycles
// record, and lowers nothing else.
//
// THE RULE. "Each challenge keeps its records: the lowest `cost`, the LOWEST
// `cycles`, and the lowest `area` over the session's completed runs of it, EACH
// METRIC INDEPENDENTLY" (`specs/modes/campaign.md`, Progression, which
// `specs/modes/extras.md` adopts: "each challenge keeps its records as
// `specs/modes/campaign.md` states"). `cycles` is "`sim.cycle + 1` at the
// completing boundary: the number of cycles the machine ran"
// (`specs/simulation.md`, Completion and metrics).
//
// HOW A RUN IS MADE THE SHORTER ONE. The same machine takes the same number of
// cycles every time — "A cycle's outcome, collisions included, is computed from
// the machine's parts, their tapes, and the sample fractions"
// (`specs/simulation.md`, Cycles and the clock) — so the run cannot be
// shortened; the RECORD is raised instead, one above what the run reaches, through
// the operation the specification provides for exactly this: "`setRecord(mode,
// index, metric, value)` Sets one record of one challenge. `metric` is `"cost"`,
// `"cycles"`, or `"area"`" (`specs/instrumentation.md`).
//
// "WHATEVER THAT RUN'S COST AND AREA" IS POSED, NOT ASSUMED. The other two records
// are put one BELOW what the run reaches, so the completion that follows is
// strictly the shorter run and strictly the dearer and wider one. A build that
// wrote the finishing run's whole metrics over the entry, or that moved the three
// records together, lowers `cost` and `area` here too and fails; a build that
// compares each metric on its own moves `cycles` alone.
//
// THE MACHINE CARRIES ONE MORE ARM THAN THE REFERENCE, for one reason: it puts a
// floor under the two figures that are posed one below themselves. An arm costs
// `PART_COSTS.arm` (`20`) and the area bank seeds "every hex of every placed
// part", so both are at least `1` and `setRecord`'s "whole number of at least `0`"
// can be reached.
//
// THE VERDICT. `extras.records[0].cycles` is the run's own figure rather than the
// higher one that was standing, while `cost` and `area` are still the lower
// figures that were posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
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

it("replaces the cycles record alone when a shorter run completes the Extra", async () => {
  await h.debug.reset();
  const machine = withOneMoreArm(await referenceSolution(h, "extras", INDEX));

  const first = await complete(INDEX, machine);
  const ran = first.sim?.metrics ?? null;
  assertNotNull(
    ran,
    "a completed run reports the three metrics it achieved as sim.metrics",
  );
  const cycles = ran?.cycles ?? -1;
  const cost = ran?.cost ?? -1;
  const area = ran?.area ?? -1;
  assertGreaterThanOrEqual(
    cycles,
    1,
    "cycles is sim.cycle + 1 at the completing boundary, so a completed run ran " +
      "at least one cycle and a record one above it is a whole number",
  );
  assertGreaterThanOrEqual(
    cost,
    PART_COSTS.arm,
    "the machine carries the arm this check added, so its cost is at least " +
      `PART_COSTS.arm (${PART_COSTS.arm}) and a record one below it is a whole number`,
  );
  assertGreaterThan(
    area,
    0,
    "the bank seeds every hex of every placed part, so a machine with an arm on " +
      "it banks at least one hex and a record one below it is a whole number",
  );

  await h.debug.setRecord("extras", INDEX, "cycles", cycles + 1);
  await h.debug.setRecord("extras", INDEX, "cost", cost - 1);
  await h.debug.setRecord("extras", INDEX, "area", area - 1);
  const posed = (await h.snapshot()).extras.records[INDEX] ?? null;
  assertEqual(
    posed?.cycles,
    cycles + 1,
    "the standing cycles record is one cycle above what this machine's run " +
      "reaches, so the completion that follows is the shorter of the two",
  );
  assertEqual(
    posed?.cost,
    cost - 1,
    "the standing cost record is one below what this machine's run spends, so " +
      "the completion that follows is the dearer of the two",
  );
  assertEqual(
    posed?.area,
    area - 1,
    "the standing area record is one below what this machine's run banks, so " +
      "the completion that follows is the wider of the two",
  );

  const second = await complete(INDEX, machine);

  await openSelect(h, "extras");
  await captureStill(h, "lowered");

  assertEqual(
    second.sim?.metrics?.cycles,
    cycles,
    "the same machine runs the same cycles every time, so the second " +
      "completion is the run the record was raised above",
  );
  const record = (await h.snapshot()).extras.records[INDEX] ?? null;
  assertEqual(
    record?.cycles,
    cycles,
    "the challenge keeps the LOWEST cycles over the session's completed runs, " +
      "so the shorter run's figure replaces the record",
  );
  assertEqual(
    record?.cost,
    cost - 1,
    "each metric moves independently, so a run that is dearer than the standing " +
      "cost record leaves that record alone however short it was",
  );
  assertEqual(
    record?.area,
    area - 1,
    "each metric moves independently, so a run that is wider than the standing " +
      "area record leaves that record alone however short it was",
  );
});

// extras/area-record-holds-against-a-higher-run — a wider completion leaves the
// area record, even while it lowers the cycles record.
//
// THE RULE. "Each challenge keeps its records: the lowest `cost`, the lowest
// `cycles`, and the LOWEST `area` over the session's completed runs of it, EACH
// METRIC INDEPENDENTLY" (`specs/modes/campaign.md`, Progression, which
// `specs/modes/extras.md` adopts: "each challenge keeps its records as
// `specs/modes/campaign.md` states"). Independently in both directions: a
// completion that beats the cycles record and not the area record moves the one
// and not the other.
//
// HOW ONE RUN IS BOTH. The same machine banks the same hexes and takes the same
// cycles every time — "A cycle's outcome, collisions included, is computed from
// the machine's parts, their tapes, and the sample fractions"
// (`specs/simulation.md`, Cycles and the clock) — so the two
// RECORDS are moved instead, through "`setRecord(mode, index, metric, value)`
// Sets one record of one challenge" (`specs/instrumentation.md`): the area record
// one BELOW what the run banks, so the completion is the wider of the two, and
// the cycles record one ABOVE what the run takes, so the same completion is the
// shorter of the two. One run, improving one metric and not the other, which is
// exactly the sentence this point decides.
//
// THE MACHINE CARRIES ONE MORE ARM THAN THE REFERENCE, for one reason: the area
// bank seeds "every hex of every placed part", so a machine with an arm on it
// banks at least one hex and the area record one below it is the "whole number of
// at least `0`" `setRecord` takes.
//
// THE VERDICT. `extras.records[0].area` is still the posed lower figure, while
// `extras.records[0].cycles` has moved to the run's own shorter one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
} from "../assert";
import { ARM_MIN_LEN, CAMPAIGN_REFERENCE_CYCLES, SPEEDS } from "../constants";
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

it("keeps the area record while a wider, shorter run lowers the cycles record", async () => {
  await h.debug.reset();
  const machine = withOneMoreArm(await referenceSolution(h, "extras", INDEX));

  const first = await complete(INDEX, machine);
  const ran = first.sim?.metrics ?? null;
  assertNotNull(
    ran,
    "a completed run reports the three metrics it achieved as sim.metrics",
  );
  const area = ran?.area ?? -1;
  const cycles = ran?.cycles ?? -1;
  assertGreaterThan(
    area,
    0,
    "the bank seeds every hex of every placed part, so a machine with an arm on " +
      "it banks at least one hex and a record one below it is a whole number",
  );

  await h.debug.setRecord("extras", INDEX, "area", area - 1);
  await h.debug.setRecord("extras", INDEX, "cycles", cycles + 1);
  const posed = (await h.snapshot()).extras.records[INDEX] ?? null;
  assertEqual(
    posed?.area,
    area - 1,
    "the standing area record is one hex below what any run of this machine " +
      "banks, so the completion that follows is the wider of the two",
  );
  assertEqual(
    posed?.cycles,
    cycles + 1,
    "the standing cycles record is one cycle above what any run of this machine " +
      "takes, so the same completion is the shorter of the two",
  );

  const second = await complete(INDEX, machine);

  await openSelect(h, "extras");
  await captureStill(h, "held");

  assertGreaterThan(
    second.sim?.metrics?.area ?? -1,
    area - 1,
    "the second run banks more hexes than the standing record, which is what " +
      "makes it the wider run",
  );
  assertLessThan(
    second.sim?.metrics?.cycles ?? Number.POSITIVE_INFINITY,
    cycles + 1,
    "the second run takes fewer cycles than the standing record, which is what " +
      "makes it the shorter run",
  );
  const record = (await h.snapshot()).extras.records[INDEX] ?? null;
  assertEqual(
    record?.area,
    area - 1,
    "the challenge keeps the LOWEST area over the session's completed runs, so " +
      "a wider completion leaves the area record at the lower figure",
  );
  assertEqual(
    record?.cycles,
    cycles,
    "each metric moves independently, so the same completion that left the area " +
      "record alone still takes the cycles record it did beat",
  );
});

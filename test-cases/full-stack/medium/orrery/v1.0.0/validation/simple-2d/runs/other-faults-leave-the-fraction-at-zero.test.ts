// runs/other-faults-leave-the-fraction-at-zero — `collision` is the one fault that
// leaves the clock part way through a cycle; every other fault leaves
// `sim.fraction` at `0`.
//
// THE RULE. "A `collision` leaves the fraction at that sample's `k / 8`; every
// other fault and completion leaves it at `0`" (`specs/simulation.md`, Cycles and
// the clock). `FAULTS` names the others under Faults, and this check poses the
// three the item names, one per row of that table:
//
//   - `overextended` — "`extend` on a piston already at `ARM_MAX_LEN` (`3`)". A
//     piston at `(0, 0)` on the tape `extend, extend, extend`: the first two take
//     it from `ARM_MIN_LEN` (`1`) to `3`, and the third is the fault.
//   - `track-end` — "`advance` at the last cell, or `recede` at the first cell, of
//     an open track". A piston mounted on the first cell of a five-cell open track
//     on the tape `advance`: four cycles walk it to the last cell, and the fifth is
//     the fault.
//   - `impossible` — "`extend` or `retract` on a part that is not a piston". An
//     `arm` on the tape `blank, extend`: the blank rests, because "A blank cell is
//     a rest on every part ... and never faults", and the `extend` is the fault.
//
// All three are FETCH faults, raised at the cycle's first step: "Each part reads
// its tape cell for this cycle ... A non-blank cell the part cannot perform raises
// the fault named for it under Faults."
//
// EVERY SCENARIO READS A CLOCK THAT WAS MOVING. Each is driven `0.4` of a cycle
// first, and that fraction is read back before the faulting cycle is reached, so a
// build whose fraction never leaves `0` fails here rather than passing three
// verdicts by standing still. Each tape also begins with at least one cycle that
// cannot fault, so the partial cycle the guard reads is a cycle the run was
// genuinely allowed to be inside.
//
// THE VERDICT. In each of the three the run ends `faulted` with the fault kind the
// row names, and `sim.fraction` reads `0` — through `assertNear` at
// `FRACTION_TOLERANCE`, since `specs/instrumentation.md` carries the fraction as a
// running sum whose figures "agree to within the rounding of that sum rather than
// bit for bit", and `0` is a value of that sum like any other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE, type FaultName } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart, type Solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  openBareRun,
  type Harness,
} from "../harness";

/** How far into the first cycle each scenario is read before it is driven on. */
const PART_WAY = 0.4;

/** The five cells of the open track the `track-end` scenario walks off the end of. */
const PATH = [at(-2, 0), at(-1, 0), at(0, 0), at(1, 0), at(2, 0)];

/** One posed fault: the machine that raises it, and how far it has to be driven. */
interface Doomed {
  kind: FaultName;
  why: string;
  machine: Solution;
  cycles: number;
}

const DOOMED: readonly Doomed[] = [
  {
    kind: "overextended",
    why: "the third extend is on a piston already at ARM_MAX_LEN",
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [
        "extend",
        "extend",
        "extend",
      ]),
    ]),
    cycles: 6,
  },
  {
    kind: "track-end",
    why: "the fifth advance is at the last cell of an open track",
    machine: solution([
      trackPart(PATH),
      armPart("piston", PATH[0]?.q ?? 0, PATH[0]?.r ?? 0, 0, ARM_MIN_LEN, [
        "advance",
      ]),
    ]),
    cycles: 8,
  },
  {
    kind: "impossible",
    why: "extend is on an arm, which is not a piston",
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [null, "extend"]),
    ]),
    cycles: 4,
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves sim.fraction at 0 on an overextended, a track-end and an impossible fault", async () => {
  for (const doomed of DOOMED) {
    await openBareRun(h, { challenge: BARE, machine: doomed.machine });

    const opened = await h.snapshot();
    assertEqual(
      opened.sim?.status,
      "running",
      `${doomed.kind}: startRun leaves the run running`,
    );

    await advanceFraction(h, PART_WAY);

    const moving = await h.snapshot();
    assertNull(
      moving.sim?.fault,
      `${doomed.kind}: the first cycle cannot fault, so the run is still clean part way through it`,
    );
    assertNear(
      moving.sim?.fraction ?? -1,
      PART_WAY,
      FRACTION_TOLERANCE,
      `${doomed.kind}: the fraction advances with game time before the faulting cycle`,
    );

    await advanceCycles(h, doomed.cycles);
    await captureStill(h, "faulted");

    const faulted = await h.snapshot();
    assertNotNull(
      faulted.sim,
      `${doomed.kind}: the run is still live after the cycle that faulted it`,
    );
    assertEqual(
      faulted.sim?.status,
      "faulted",
      `${doomed.kind}: ${doomed.why}, so the run faults`,
    );
    assertEqual(
      faulted.sim?.fault?.kind,
      doomed.kind,
      `${doomed.kind}: ${doomed.why}`,
    );
    assertNear(
      faulted.sim?.fraction ?? -1,
      0,
      FRACTION_TOLERANCE,
      `${doomed.kind}: every fault but collision leaves the fraction at 0`,
    );
  }
});

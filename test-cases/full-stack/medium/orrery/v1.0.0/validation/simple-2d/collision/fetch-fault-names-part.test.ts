// collision/fetch-fault-names-part — every fetch fault names the part that could
// not perform its cell.
//
// THE RULE, from the payload table of `specs/simulation.md` (Faults): "Every fetch
// fault — `parts`: the faulting part; `motes`: empty." A fetch fault is one raised
// at step 1 of the cycle, "A non-blank cell the part cannot perform raises the
// fault named for it under Faults", and `FAULTS` lists five of them:
// `overextended`, `overretracted`, `unmounted`, `track-end` and `impossible`.
//
// THE CONFIGURATIONS. One per fetch fault, each posed on its own bare run so no
// other part is on the field to be named in its place, and each placing a SECOND
// part that faults at nothing — an arm at `(0, 3)` with a blank tape, "A blank cell
// is a rest on every part, a wheel included, and never faults". The bystander is
// what makes the reading say "the faulting part" rather than "the only part":
//
//   * `overextended` — a piston at rest length `ARM_MAX_LEN` (`3`) with `extend`.
//   * `overretracted` — a piston at rest length `ARM_MIN_LEN` (`1`) with `retract`.
//   * `unmounted` — an arm on no track with `advance`: "`unmounted` — `advance` or
//     `recede` on a part not on a track".
//   * `track-end` — an arm on the last cell of an open track with `advance`.
//   * `impossible` — an arm with `extend`: "`impossible` — `extend` or `retract` on
//     a part that is not a piston".
//
// THE VERDICT. In every case `sim.fault.parts` is exactly the one faulting part's
// id, and not the bystander's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart, type SolutionPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** An arm that faults at nothing, so a fault has something it must NOT name. */
const BYSTANDER: SolutionPart = armPart("arm", 0, 3, 0, 1, []);

/** One fetch fault: the machine that raises it, and which part is the culprit. */
const CASES: readonly {
  kind: string;
  machine: SolutionPart[];
  culprit: number;
}[] = [
  {
    kind: "overextended",
    machine: [armPart("piston", 0, 0, 0, ARM_MAX_LEN, ["extend"]), BYSTANDER],
    culprit: 0,
  },
  {
    kind: "overretracted",
    machine: [armPart("piston", 0, 0, 0, ARM_MIN_LEN, ["retract"]), BYSTANDER],
    culprit: 0,
  },
  {
    kind: "unmounted",
    machine: [armPart("arm", 0, 0, 0, 1, ["advance"]), BYSTANDER],
    culprit: 0,
  },
  {
    kind: "track-end",
    machine: [
      trackPart([at(0, 0), at(1, 0), at(2, 0)]),
      armPart("arm", 2, 0, 0, 1, ["advance"]),
      BYSTANDER,
    ],
    culprit: 1,
  },
  {
    kind: "impossible",
    machine: [armPart("arm", 0, 0, 0, 1, ["extend"]), BYSTANDER],
    culprit: 0,
  },
];

it("names the faulting part in sim.fault.parts, for every fetch fault", async () => {
  for (const { kind, machine, culprit } of CASES) {
    await openBareRun(h, { challenge: BARE, machine: solution(machine) });
    const placed = await partIds(h);

    await advanceCycles(h, 1);
    await h.advance(1);
    await captureStill(h, "named");

    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `the run is still live after the ${kind} fault`);
    assertEqual(sim?.fault?.kind, kind, `the machine raises ${kind}`);
    assertDeepEqual(
      sim?.fault?.parts,
      [placed[culprit]],
      `a ${kind} fault names the part that could not perform its cell, and nothing else`,
    );
  }
});

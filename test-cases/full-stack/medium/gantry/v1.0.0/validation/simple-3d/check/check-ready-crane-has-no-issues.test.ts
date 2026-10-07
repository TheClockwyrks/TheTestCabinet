// check/check-ready-crane-has-no-issues — a crane that breaks no readiness rule
// reports an empty issues list.
//
// specs/structure.md § Readiness closes its table with "A structure with no
// readiness issues is ready to run", the four rows being `no-ring`, `no-rail`,
// `invalid-rail` and `disconnected-members`. specs/program.md adds the fifth
// thing that would refuse a run, `empty-program` for an empty tape, and
// specs/instrumentation.md has `check` report all five in one `issues` list.
// "Ready to run" is therefore exactly `issues` reading empty.
//
// The scenario is the smallest crane that breaks none of the four: the harness's
// `MINIMAL_CRANE` stands a ring on a braced tower, carries one horizontal rail
// in the arm whose two ends lie at distinct horizontal distances from the slew
// axis, and holds no member outside the tower or the arm. One move step is
// appended after it, because without a tape the reading would still carry
// `empty-program` and "an empty issues list" could not be the thing read.
//
// The yard is emptied first and no load or obstacle is added back: readiness is
// a property of the structure and the tape alone, and a bystander in the yard
// would only add a way for the pose itself to be refused.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One move step: the least a tape can hold and still not be empty. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no issue for a crane with a ring, a sound track, nothing stray and a tape", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture(
    "issues-structure-issues",
    "the check of a crane that breaks no readiness rule",
  );

  assertLength(
    issues,
    0,
    "the issues a ready crane with a tape reports, so it is ready to run " +
      "(specs/structure.md § Readiness)",
  );
});

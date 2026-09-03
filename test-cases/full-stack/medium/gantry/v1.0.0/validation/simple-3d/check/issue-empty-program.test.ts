// check/issue-empty-program — an empty tape reports `empty-program`.
//
// specs/structure.md § The static check lists what the check reports first: "The
// issues that would refuse a run: the readiness issues above, and
// `empty-program` for an empty tape (`specs/program.md`)".
//
// The tape is emptied by an ACT rather than left empty by accident: a step is
// appended and then `clearProgram` takes it away, so the reading is of a tape the
// scenario emptied. The crane underneath is ready, so nothing else can be
// mistaken for the issue under test — a readiness issue in the list would leave
// `empty-program` sitting beside an issue this point is not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names empty-program among the issues once the tape is emptied", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);

  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.setScreen("build");

  const result = await h.check();
  const { program } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(program, 0, "the tape clearProgram emptied");
  assertContains(
    result.issues,
    "empty-program",
    "the issue an empty tape reports (specs/structure.md § The static check)",
  );
});

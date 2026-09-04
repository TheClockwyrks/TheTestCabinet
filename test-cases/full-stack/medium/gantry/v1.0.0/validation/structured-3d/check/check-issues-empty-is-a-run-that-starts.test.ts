// check/check-issues-empty-is-a-run-that-starts — a check reporting no issue is a
// run that starts.
//
// specs/structure.md § The static check says what the issues ARE: "The issues
// that would refuse a run: the readiness issues above, and `empty-program` for an
// empty tape". specs/program.md § Starting and ending a run says the same from
// the run's side: "Starting is refused, with the issues listed and no run begun,
// when the structure has a readiness issue (`specs/structure.md`) or the tape is
// empty (`empty-program`)." Those are the same two conditions, so an empty
// `issues` is not merely consistent with a run starting — it is the whole of what
// would have stopped one, and the run must begin.
//
// THE RUN IS TAKEN THROUGH `startRun`, which specs/instrumentation.md defines as
// posing "the `run` action: the same refusals, the same `run-start`, and the same
// move to the run screen as `specs/program.md` states". A key press would put the
// `run` binding between this item and the requirement it decides.
//
// The crane is the minimal one and the tape is one step, so the check has nothing
// to report and the run has something to do.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the run when the check reports an empty issue list", async () => {
  await openSite(h, 0);
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

  const { issues } = await h.check();
  assertLength(
    issues,
    0,
    "the issues of a ready crane carrying a tape: nothing would refuse a run " +
      "(specs/structure.md)",
  );

  await h.debug.startRun();
  const started = await h.snapshot();
  assertEqual(
    started.run.phase,
    "running",
    "the run the `run` action starts when the check reports no issue " +
      "(specs/program.md)",
  );

  await h.capture("started", "the run that started on an empty issue list");
});

// rigging/release-with-nothing-attached — a release off an empty hook fails the
// run.
//
// specs/rigging.md, Releasing: "`release` with nothing attached ends the run the
// same way" — as `release-misplaced`, the same verdict a release that fails one
// of the three tests carries. There is no third outcome: a release the hook
// cannot honour is not quietly skipped and does not end the run under some cause
// of its own.
//
// THE HOOK IS EMPTY BECAUSE THE YARD IS. A run's loads "are the ones standing
// when it starts" (`specs/instrumentation.md`), and this one starts on an emptied
// yard, so the hook is bare at tick zero with nothing that could have found its
// way onto it — the state the requirement names, reached by removing everything
// rather than by arranging something.
//
// THE TAPE IS THE ONE STEP. `specs/program.md`: an action step "is taken,
// executed, and complete on one tick", and the run's first tick is the one that
// takes the tape's first step, so the release executes on tick one and the
// verdict is read there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The tape: one release, taken and executed on the run's first tick. */
const TAPE: readonly TapeStepSpec[] = [{ kind: "action", action: "release" }];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as release-misplaced when the hook is holding nothing", async () => {
  await openSite(h, SITE);
  // The yard is what has to be empty — the hook is bare because nothing is
  // standing to be lifted — so the loads and the obstacles go and nothing else
  // does: `standMinimalCrane` empties the structure itself, and the tape is
  // posed below onto the empty one the site opens with.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);

  assertNull(
    started.run.attached,
    "what hangs on the hook as the run starts, with the yard emptied " +
      "(specs/state.md)",
  );

  const after = await runTicks(h, 1);
  await h.capture("empty-hook", "The release taken off an empty hook");

  assertEqual(
    after.run.cause,
    "release-misplaced",
    "the cause a release with nothing attached ends the run with " +
      "(specs/rigging.md)",
  );
});

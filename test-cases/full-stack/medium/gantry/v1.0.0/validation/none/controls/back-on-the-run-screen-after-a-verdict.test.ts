// controls/back-on-the-run-screen-after-a-verdict — `back` on a run that has
// ended returns to the build screen.
//
// `specs/ui.md` § Run: "`back` aborts a run in progress, as `specs/program.md`
// states, and otherwise returns to `build`." `specs/controls.md` § The actions
// resolves `back` against the first row that applies, and the run-screen row
// reads "The run screen, WITH A RUN IN PROGRESS": with no run in progress that
// row does not apply, so the last row decides and the screen leaves for the one
// `specs/ui.md` gives it.
//
// THE RUN HAS TO HAVE ENDED AND THE SCREEN HAS TO STILL BE THE RUN SCREEN, which
// a failed run is exactly: "A failed run stays on the run screen with its cause
// read out and the scene as it stood, so the player reads what went wrong before
// going back to edit" (`specs/program.md`). A cleared run moves to `results` and
// an aborted one has already left, so the failed run is the only state in which
// this row of the table can be read at all.
//
// THE FAILURE IS THE CHEAPEST ONE THE SPECIFICATION GIVES. The world is emptied,
// so the yard holds no load; the tape is one `attach`; and `specs/rigging.md` §
// Attaching says "With no candidate, the run ends as `attach-missed`." Nothing
// about the structure or the geometry is involved, so the run reaches its verdict
// on its first tick and the scenario is decided by the `back` that follows.
//
// THE VERDICT IS SWEPT TO RATHER THAN COUNTED OUT: `runUntil` fails the item on
// its cap, so a build whose run never ends reports that rather than falling
// through to a reading of a run still in progress.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

/** A tape whose one action finds nothing to take, so the run fails at once. */
const MISS_TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
];

/** The ticks the verdict is swept for: an `attach` executes on the first. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the build screen from a run that has already ended", async () => {
  await openSite(h, 0);
  // The yard is emptied and nothing else is. A site opened after a reset
  // carries an empty structure and an empty tape (specs/state.md), and the
  // crane and the tape below are posed onto them; clearing either again would
  // drive surface this requirement does not concern.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, MISS_TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run to reach a verdict",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the run this `back` is pressed on, an `attach` with nothing in the yard " +
      "to take (specs/rigging.md § Attaching)",
  );
  assertEqual(
    ended.screen,
    "run",
    "the screen a failed run stays on (specs/program.md)",
  );

  await h.press(BACK);
  await h.advance(1);

  const after = await h.snapshot();

  await h.capture("state", "the build screen back returned to from a verdict");

  assertEqual(
    after.screen,
    "build",
    `the screen after ${BACK} on a run screen with no run in progress: ` +
      "`back` aborts a run in progress and otherwise returns to `build` " +
      "(specs/ui.md § Run)",
  );
});

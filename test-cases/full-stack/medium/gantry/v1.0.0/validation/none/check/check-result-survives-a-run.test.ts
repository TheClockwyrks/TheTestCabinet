// check/check-result-survives-a-run — a run does not clear the result the check
// action left on the build screen.
//
// specs/structure.md § The static check: "The result the action leaves stands
// until the structure or the tape changes, when it goes back to none. The build
// screen shows it until then, so what is shown always describes the crane and the
// tape on screen." A run changes neither: specs/program.md ends with "the
// structure, the tape, and the loads' starting poses are untouched", and
// specs/state.md says of a run's broken list that "the structure itself is
// untouched, so the build screen and its check read every member". So the result
// the player left on the build screen is the one waiting for them when the run
// ends and they come back.
//
// THE RUN IS REACHED AND LEFT THROUGH THE SURFACE. The run is started with
// `startRun`, which "poses the `run` action", and the build screen is returned to
// with `setScreen`, which "shows a named screen and sets nothing else" — a
// broken `back` binding is another item's failure and must not be this one's.
//
// The run fails rather than clears: its one step commands the hoist to `0`, below
// `HOIST_MIN` (`1`), which specs/program.md ends as `command-out-of-range` on the
// tick the step starts. That is a run that has genuinely been through the
// pipeline, and it leaves the game on the run screen with a verdict to come back
// from.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `check` action to. */
const CHECK_KEY = BINDINGS.check[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still shows the check result once a run has been and gone", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  // A hoist target below `HOIST_MIN`, so the first tick that takes the step ends
  // the run rather than the tape running to a verdict of its own.
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_MIN - 1, rate: HOIST_MAX_RATE },
      ],
    },
  ]);

  await h.debug.showCheck();
  const shown = (await h.snapshot()).checkResult;
  assertNotNull(
    shown,
    "the result the `check` action leaves on the build screen " +
      "(specs/structure.md)",
  );

  await startRun(h);
  const ran = await runTicks(h, 1);
  assertEqual(
    ran.run.phase,
    "failed",
    "the run the tape ran, ended by its own rules (specs/program.md)",
  );

  await h.debug.setScreen("build");
  const back = await h.snapshot();
  assertDeepEqual(
    back.checkResult,
    shown,
    "the check result the build screen is showing after the run: the same " +
      "issues, cost, budget, verdict and member list the action left, since " +
      "the run changed neither the structure nor the tape " +
      "(specs/structure.md)",
  );

  await h.advance(1);
  await h.capture(
    "still-shown",
    "the check result still on the build screen after the run",
  );
});

// tape/hoist-range-max — the hoist's range runs up to HOIST_MAX, so a step
// targeting it is accepted and one a unit past it ends the run.
//
// `specs/program.md` § The axes gives the `hoist` row the range "`HOIST_MIN` (`1`)
// to `HOIST_MAX` (`40`)", and § The tape gives what a target outside it costs: "A
// step whose command targets a value outside its axis's range at that moment ends
// the run as `command-out-of-range`."
//
// BOTH SIDES OF THE ONE BOUND, IN ONE CHECK: `40` is inside the range and `41` is
// outside it, and a build that put the bound in the wrong place, or made it
// exclusive, answers differently on exactly one of the two.
//
// WHAT "INSIDE THE RANGE" IS READ AS, AND WHY IT IS NOT ARRIVAL. A cable of `40`
// units cannot hang anywhere in this game: the build envelope reaches `y = 16` at
// the tallest site (`specs/sites.md`), so the hook on a `40`-unit cable stands far
// below the ground, and `specs/statics.md` ends such a run as
// `load-struck-ground` — "With no load attached, the hook point below `0` ends
// the run the same way." Driving to `40` therefore measures the ground rule and
// not the range. What the range fixes is whether the step is ISSUED, which
// `specs/program.md` settles at the step's start: the tick that takes the step
// either issues the command or ends the run. So the reading is that tick — the
// first, where the accepted target stands as the axis's live command and the
// refused one has already ended the run — and the hook is still forty ticks above
// the ground when it is taken.
//
// The two runs are posed on the same crane one after the other; the tape is
// emptied between them so each run carries the one step it is about, on the
// program screen where the tape poses apply and where the second run is then
// started from — `startRun` "applies on the build and program screens, where the
// `run` action does" (specs/instrumentation.md). The yard is empty: nothing here
// concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE } from "../constants";
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

/** A unit past the bound: outside the range, and nowhere near a rounding. */
const ABOVE = HOIST_MAX + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("issues a hoist command targeting HOIST_MAX and refuses one above it", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);

  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MAX, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);
  const issued = await runTicks(h, 1);
  assertNull(
    issued.run.cause,
    `the failure cause of a run whose first step targets the hoist at ` +
      `${HOIST_MAX}, which is HOIST_MAX and inside the range ` +
      "(specs/program.md)",
  );
  assertNotNull(
    issued.run.axes.hoist.command,
    `the command live on the hoist after the tick that took a step ` +
      `targeting ${HOIST_MAX} (specs/program.md)`,
  );
  assertEqual(
    issued.run.axes.hoist.command?.target,
    HOIST_MAX,
    "the target the issued command carries (specs/program.md)",
  );
  await h.debug.abortRun();

  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: ABOVE, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);
  const refused = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    refused.run.phase,
    "failed",
    `the phase of a run whose first step targets the hoist at ${ABOVE}, ` +
      `above HOIST_MAX (${HOIST_MAX}) (specs/program.md)`,
  );
  assertEqual(
    refused.run.cause,
    "command-out-of-range",
    "the cause a target outside the axis's range ends the run with " +
      "(specs/program.md)",
  );
});

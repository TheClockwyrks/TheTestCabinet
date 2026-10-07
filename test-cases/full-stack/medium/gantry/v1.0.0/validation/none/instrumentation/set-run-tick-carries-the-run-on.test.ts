// instrumentation/set-run-tick-carries-the-run-on — the run counts on from the
// tick count posed.
//
// specs/instrumentation.md § The run in progress: "`setRunTick` poses how long
// the run has been going and nothing else ... the run's next tick is numbered
// one above it." A pose "establishes a precondition and never an outcome", so
// the run carries on from the number it was handed rather than from a count of
// its own.
//
// THE FAILURE THIS CATCHES is a build that answers the pose out of a field the
// snapshot reads while its tick loop counts somewhere else: such a build reports
// twelve hundred at the call and one on the tick after, and every scenario that
// poses a run clock and then runs is decided on the wrong clock.
//
// ONE TICK IS THE WHOLE OF THE DRIVE. The tape holds three steps that move
// nothing — the `hoist` commanded to the value it already stands at, which
// `specs/program.md` makes a step "done on the tick it is issued" — so the tick
// after the pose takes a step, the run is still `running`, and nothing in the
// yard has moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
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

/** Twenty seconds of run clock: far past anything this tape reaches by ticking. */
const POSED = 1200;

/**
 * One step that moves nothing: the `hoist` stands at `HOIST_START` when a run
 * starts (`specs/state.md`), so `specs/program.md` finds this command arrived on
 * the tick it is issued.
 */
const STILL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("numbers the tick after the pose one above the count posed", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [STILL, STILL, STILL]);
  await startRun(h);

  await h.debug.setRunTick(POSED);
  const ticked = await runTicks(h, 1);

  await h.capture("carried", "The run one tick past the count posed");

  assertEqual(
    ticked.run.phase,
    "running",
    "the run across the pose and the tick after it: a pose reaches no verdict " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    ticked.run.tick,
    POSED + 1,
    "run.tick on the tick after setRunTick, numbered one above the count " +
      "posed (specs/instrumentation.md)",
  );
});

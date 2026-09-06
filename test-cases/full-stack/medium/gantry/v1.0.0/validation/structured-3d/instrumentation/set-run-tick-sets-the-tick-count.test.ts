// instrumentation/set-run-tick-sets-the-tick-count — `setRunTick` sets how many
// ticks the run has taken.
//
// specs/instrumentation.md § The run in progress: "`setRunTick(tick)` — Sets the
// number of ticks the run has taken, from which the run clock is `tick / TICK_HZ`
// seconds (`specs/state.md`)." The pose is what lets a scenario stand at a run
// clock a real watch would take a minute to reach, so what it poses has to be
// what the run then reports.
//
// THE NUMBER POSED IS ONE NO RUN OF THIS TAPE REACHES. `POSED` is twelve hundred
// ticks, twenty seconds of run clock, against a tape the run spends in three
// ticks — so a build that took the call and kept its own count reads a handful
// rather than twelve hundred, and the two can never be confused.
//
// THE READING IS TAKEN WITH NOTHING ADVANCED after the pose, so the tick count
// read is the one the pose wrote rather than one a later tick arrived at.
//
// The crane, the tape and the empty yard are here only because a run has to be
// in progress for a run pose to apply: the tape's one step commands the `hoist`
// to the value it already stands at, which `specs/program.md` makes a step "done
// on the tick it is issued", so nothing in the yard moves while this is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, TICK_HZ } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
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

it("reports the tick count it was handed, and the clock that follows it", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [STILL, STILL, STILL]);
  await startRun(h);

  await h.debug.setRunTick(POSED);
  const posed = await h.snapshot();

  await h.capture("clock", "The run clock at the tick count posed");

  assertEqual(
    posed.run.tick,
    POSED,
    "run.tick after setRunTick, which sets the number of ticks the run has " +
      "taken (specs/instrumentation.md)",
  );
  assertEqual(
    posed.run.time,
    POSED / TICK_HZ,
    "the run clock the posed tick count gives, that count over TICK_HZ " +
      "(specs/state.md)",
  );
});

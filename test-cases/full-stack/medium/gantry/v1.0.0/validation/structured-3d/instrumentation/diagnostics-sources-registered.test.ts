// instrumentation/diagnostics-sources-registered — the panel reports the game's
// own figures rather than a fixed caption.
//
// `specs/instrumentation.md` § Diagnostics: "The debug overlay shows the values
// the game registers with it as diagnostic sources. Register at least the
// current screen and site, the structure's member count, cost, and readiness
// issue count, the run's phase, step index, clock, and cause, each axis's value,
// the bob's position, the highest current utilization and the broken-member
// count, and the camera pose." A registered source is a source: the panel
// FOLLOWS the game, so two states of one game report two sets of figures.
//
// WHAT IS READ, UNDER AN ENGINE. Registration is the game's part and drawing the
// overlay is the engine's, so the readings are taken off the engine rather than
// off the panel: `engine.diagnostics()` answers what every registered source
// reports at the moment it is asked. That is the same requirement the engineless
// project decides by photographing the panel — a build whose panel drew a fixed
// caption, or read a copy of the game taken once, reports the same figures in
// both states — read at the place this engine puts it, and it costs nothing in
// strength: the engineless project can only see THAT the panel changed, and this
// sees WHICH figures did.
//
// WHAT CAN AND CANNOT BE HELD. The names the sources are registered under are the
// build's — "Keep each one short enough to read on a line" — so nothing here
// asserts a name. What is fixed is that the figures the paragraph above names are
// registered and that they follow the game, so the reading is the SET of values,
// and what is asserted is that it moves when the game moves.
//
// THE TWO STATES PART ONLY IN THE RUN'S CLOCK AND STEP INDEX. Both stand over the
// same crane, the same tape and the same emptied yard on site `0`, with a run in
// progress; one is a tick into it and the other a dozen, so the run's clock and
// its step index — two of the figures the paragraph above names — are apart in
// both the tenths of a second a clock reads and the step number beside it, and
// nothing else has moved: the tape is sixteen move steps that each command the
// hoist to the value it already holds, and "A command whose target is the axis's
// current value therefore has `s` of `0`: the axis neither brakes nor
// accelerates, it does not move, and step 3 finds it arrived, so the command is
// done on the tick it is issued" (`specs/program.md`), while "A tick takes at
// most one step from the tape". So the run advances a tick a step with all four
// axes, the pivot and the bob standing exactly where the run started them
// (`specs/state.md`).
//
// THE COUNT IS HELD TOO, because "at least" the fourteen figures that paragraph
// names is a floor a build has to reach: a game that registered one source could
// still make that source move.
//
// This decides that one requirement. That the backtick key toggles the panel,
// that it is off until it is toggled, and that showing it leaves the game as it
// is are three requirements of their own, decided next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * The yard both readings are taken over: emptied, one crane, one still tape.
 *
 * Posed once. Each reading below runs the same run over it, so nothing here has
 * to be built again between them.
 */
async function poseWorld(): Promise<void> {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, STILL_TAPE);
}

/** The two states: a tick into the run, and a dozen ticks into it. */
const EARLY = 1;
const LATE = 12;

/**
 * The figures `specs/instrumentation.md` names, counted: the screen, the site,
 * the member count, the cost, the readiness issue count, the run's phase, step
 * index, clock and cause, four axis values, the bob's position, the highest
 * utilization, the broken-member count, and the camera pose.
 *
 * A build is free to register more, and free to fold, say, the camera's three
 * numbers into one line, so what this holds is a FLOOR well under the count of
 * the list — enough that a panel of one caption cannot reach it.
 */
const AT_LEAST = 10;

/**
 * Sixteen move steps that ask the hoist for the value it already holds.
 *
 * One step a tick, none of them moving anything: the run's clock and step index
 * advance and the yard does not, which is what lets the two states below be told
 * apart by the run's own figures alone. Sixteen is more steps than the ticks
 * driven, so the run is still in progress at both readings rather than ended at
 * one of them — and the tape is posed a step at a time, so a longer one is a cost
 * the reading does not need.
 */
const STILL_TAPE: readonly TapeStepSpec[] = Array.from(
  { length: 16 },
  (): TapeStepSpec => ({
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  }),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * What every registered source reports `ticks` into the run, as one string.
 *
 * EACH READING STARTS THE RUN AFRESH, and starts it from the same place. The
 * abort "poses the abort, ending a running run with no verdict: `run` goes back
 * to its idle placeholder and the build screen returns", and it does nothing at
 * all before the first run; the start that follows is "the ordinary run", which
 * "starts as `specs/state.md` says a run starts: nothing has ticked at the call,
 * so `run.tick` reads `0` immediately after it, and the axes, the pivot, and the
 * bob stand at the run-start values". So each reading is taken over a run built
 * from the same starting point rather than over the leavings of the one before
 * it, and the crane, the tape and the emptied yard are `poseWorld`'s and are not
 * rebuilt between them.
 */
async function readings(ticks: number): Promise<string> {
  await h.debug.abortRun();
  await startRun(h);
  await h.advance(ticks);
  // The build screen, and the frame that draws it, in both states alike.
  await h.debug.setScreen("build");
  await h.advance(1);
  return JSON.stringify(
    h.engine
      .diagnostics()
      .map((reading) => [reading.name, reading.value ?? reading.error]),
  );
}

it("reports different figures for a different state of the game", async () => {
  await poseWorld();

  const early = await readings(EARLY);
  const late = await readings(LATE);
  await h.capture("panel", "The diagnostics over a run in progress");

  assertGreaterThan(
    h.engine.diagnostics().length,
    AT_LEAST - 1,
    "the diagnostic sources the game registers, of which " +
      "specs/instrumentation.md names the screen and site, the structure's " +
      "member count, cost and readiness issue count, the run's phase, step " +
      "index, clock and cause, each axis's value, the bob's position, the " +
      "highest utilization and broken-member count, and the camera pose",
  );
  assertTrue(
    early !== late,
    `the registered sources to report different figures at tick ${EARLY} and ` +
      `tick ${LATE} of one run, whose clock and step index are among the ` +
      "figures the game registers (specs/instrumentation.md): a source is " +
      `read when the panel is drawn rather than captioned once — they reported ${early}`,
  );
});

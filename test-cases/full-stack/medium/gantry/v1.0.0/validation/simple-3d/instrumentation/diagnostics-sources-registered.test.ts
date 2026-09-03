// instrumentation/diagnostics-sources-registered — the shown panel reports the
// game's own figures rather than a fixed caption.
//
// `specs/instrumentation.md` § Diagnostics: "The debug overlay shows the values
// the game registers with it as diagnostic sources. Register at least the
// current screen and site, the structure's member count, cost, and readiness
// issue count, the run's phase, step index, clock, and cause, each axis's value,
// the bob's position, the highest current utilization and the broken-member
// count, and the camera pose." A registered source is a source: the panel
// FOLLOWS the game, so two states of one game read two panels.
//
// THIS ENGINE'S VERSION OF THE POINT, AND IT IS READ AT THE SEAM THE
// SPECIFICATION PUTS THE BUILD'S PART AT. Under this engine that file says
// "Registering those values is the whole of Gantry's part, through
// `InitApi.diagnostics`. Each source is called with the state current at the
// read... Drawing the panel, showing and hiding it with the backtick key, and
// keeping it read-only are the engine's." So what a build owes here is the
// registered sources, and `engine.diagnostics()` is exactly them: "every
// registered diagnostic and what it reports now, in registration order",
// evaluated against the current state and changing nothing else. An engineless
// build owns the panel too, so its version of this point compares the pictures
// the page drew; here the picture is the engine's, and comparing it would grade
// the engine.
//
// WHAT CAN AND CANNOT BE READ HERE. How many sources a build registers, what it
// calls them, and how it words a value are the build's — "Keep each one short
// enough to read on a line" — so nothing about a particular name or wording is
// assertable. What IS fixed is that the sources are registered and that they read
// the game: two states of one game must read differently.
//
// THE TWO STATES PART ONLY IN THE RUN'S CLOCK AND STEP INDEX. Both stand on the
// build screen, on site `0`, over the same crane, the same tape and the same
// emptied yard, with the camera at the pose a site opening leaves, and both have
// a run in progress. One is a tick into it and the other thirty, so the run's
// clock and its step index — two of the figures the paragraph above names — are
// far apart, and every other figure the paragraph names is identical: the tape is
// forty move steps that each command the hoist to the value it already holds, and
// "A command whose target is the axis's current value therefore has `s` of `0`:
// the axis neither brakes nor accelerates, it does not move, and step 3 finds it
// arrived, so the command is done on the tick it is issued" (`specs/program.md`),
// while "A tick takes at most one step from the tape". So the run advances a tick
// a step with all four axes, the pivot and the bob standing exactly where the run
// started them (`specs/state.md`).
//
// A build whose sources returned fixed captions, or read a copy of the game taken
// once, reads the same panel in both states and fails. A build that registers the
// sources reads two.
//
// A SOURCE THAT THREW IS A FAILURE OF ITS OWN, and it is named rather than folded
// into the comparison: "keep every source a pure read", and a source that raised
// reported nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
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

/** The two states: a tick into the run, and thirty ticks into it. */
const EARLY = 1;
const LATE = 30;

/**
 * Forty move steps that ask the hoist for the value it already holds.
 *
 * One step a tick, none of them moving anything: the run's clock and step index
 * advance and the yard does not, which is what lets the two states below be told
 * apart by the panel alone. Forty is more steps than the ticks driven, so the
 * run is still in progress at both readings rather than ended at one of them.
 */
const STILL_TAPE: readonly TapeStepSpec[] = Array.from(
  { length: 40 },
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
 * Pose one of the two states and read every registered source over it.
 *
 * The pose starts from a `reset`, which "returns the game to its title state"
 * (`specs/instrumentation.md`), so each of the two readings below is taken over a
 * state built from the same starting point rather than over the leavings of the
 * reading before it.
 *
 * `engine.diagnostics()` evaluates each source against the state as it stands and
 * changes nothing else, so the reading is the same whether the panel is drawn or
 * hidden — which is what lets this point be decided without posing the engine's
 * overlay at all.
 */
async function panel(ticks: number): Promise<string> {
  await h.debug.reset();
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, STILL_TAPE);
  await startRun(h);
  await h.advance(ticks);
  // The build screen, and the frame that draws it, in both states alike.
  await h.debug.setScreen("build");
  await h.advance(1);

  const read = h.engine.diagnostics();
  if (read.length === 0) {
    fail(
      "the game to register its figures with the overlay as diagnostic " +
        "sources, through InitApi.diagnostics (specs/instrumentation.md)",
      "engine.diagnostics() reports no source at all",
    );
  }
  const raised = read.filter((one) => one.error !== undefined);
  if (raised.length > 0) {
    fail(
      "every diagnostic source to be a pure read that reports a value " +
        "(specs/instrumentation.md)",
      raised
        .map((one) => `${one.name} threw: ${String(one.error)}`)
        .join(", "),
    );
  }
  return read
    .map((one) => `${one.name}=${JSON.stringify(one.value)}`)
    .join("\n");
}

it("reads a different panel for a different state of the game", async () => {
  const early = await panel(EARLY);
  const late = await panel(LATE);
  await h.capture("panel", "The panel over a run in progress");

  assertTrue(
    early !== late,
    `the registered sources to read differently at tick ${EARLY} and tick ` +
      `${LATE} of one run, whose clock and step index are among the figures ` +
      "the game registers as diagnostic sources " +
      `(specs/instrumentation.md) — both read "${early.replace(/\n/g, ", ")}"`,
  );
});

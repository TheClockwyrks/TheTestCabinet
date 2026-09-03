// instrumentation/diagnostics-sources-registered — the shown panel reports the
// game's own figures rather than a fixed caption.
//
// `specs/instrumentation.md` § Diagnostics: "The debug overlay shows the values
// the game registers with it as diagnostic sources. Register at least the
// current screen and site, the structure's member count, cost, and readiness
// issue count, the run's phase, step index, clock, and cause, each axis's value,
// the bob's position, the highest current utilization and the broken-member
// count, and the camera pose." A registered source is a source: the panel
// FOLLOWS the game, so two states of one game draw two panels.
//
// WHAT CAN AND CANNOT BE READ HERE. The panel's layout, its wording, and where
// on the page it sits are the build's — "Keep each one short enough to read on a
// line", "Keep it visually plain and clearly separate from the game's own
// display" — so nothing about its text is assertable, and reading it as text
// would grade a design rather than the requirement. What IS fixed is that it
// changes when the figures it shows change. So the check compares the page's own
// picture between two states of the game, once with the panel hidden and once
// with it shown.
//
// THE TWO STATES PART ONLY IN THE RUN'S CLOCK AND STEP INDEX. Both stand on the
// build screen, on site `0`, over the same crane, the same tape and the same
// emptied yard, with the camera at the pose a site opening leaves, and both have
// a run in progress. One is a tick into it and the other thirty, so the run's
// clock and its step index — two of the figures the paragraph above names — are
// far apart, and every other figure a build could draw the yard from is
// identical: the tape is forty move steps that each command the hoist to the
// value it already holds, and "A command whose target is the axis's current
// value therefore has `s` of `0`: the axis neither brakes nor accelerates, it
// does not move, and step 3 finds it arrived, so the command is done on the tick
// it is issued" (`specs/program.md`), while "A tick takes at most one step from
// the tape". So the run advances a tick a step with all four axes, the pivot and
// the bob standing exactly where the run started them (`specs/state.md`).
//
// THAT IS WHAT MAKES THE COMPARISON SOUND, AND THE CHECK ASSERTS IT FIRST. The
// build screen shows "the yard through the camera ... and the structure as
// built", with readouts of "the site's name, the cost against the budget, the
// tool palette ... and the tape's step count" (`specs/ui.md`) — not one run
// figure among them — and nothing the run touched has moved. So with the panel
// hidden the two states draw the same picture, and what parts them with the
// panel shown is the panel.
//
// A build whose panel drew a fixed caption, or read a copy of the game taken
// once, draws the same panel in both states and fails. A build that registers
// the sources draws two.
//
// This decides that one requirement. That the backtick key toggles the panel,
// that it is off until it is toggled, and that showing it leaves the game as it
// is are three requirements of their own, decided next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
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

/** The key the overlay is shown and hidden by (`specs/instrumentation.md`). */
const TOGGLE = "Backquote";

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
let overlayShown = false;

beforeEach(async () => {
  h = await createHarness();
  overlayShown = false;
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Show or hide the panel, pose one of the two states, and picture the page.
 *
 * The pose starts from a `reset`, which "returns the game to its title state"
 * (`specs/instrumentation.md`), so each of the four pictures below is taken over
 * a state built from the same starting point rather than over the leavings of
 * the picture before it.
 */
async function picture(shown: boolean, ticks: number): Promise<Buffer> {
  if (shown !== overlayShown) {
    await h.press(TOGGLE);
    overlayShown = shown;
  }
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
  return h.page.screenshot({ type: "png" });
}

it("draws a different panel for a different state of the game", async () => {
  // Hidden: the game's own display, in the two states.
  const earlyHidden = await picture(false, EARLY);
  const lateHidden = await picture(false, LATE);

  // Shown: the same two states, with the panel over them.
  const earlyShown = await picture(true, EARLY);
  const lateShown = await picture(true, LATE);
  await h.capture("panel", "The panel over a run in progress");

  assertTrue(
    earlyHidden.equals(lateHidden),
    "the game's own display to be the same at both ticks with the panel " +
      "hidden — the build screen shows no run figure (specs/ui.md) and the " +
      "still tape moves nothing — so that what parts them with the panel " +
      "shown is the panel",
  );
  assertTrue(
    !earlyShown.equals(lateShown),
    `the shown panel to differ between tick ${EARLY} and tick ${LATE} of one ` +
      "run, whose clock and step index are among the figures the game " +
      "registers as diagnostic sources (specs/instrumentation.md)",
  );
});

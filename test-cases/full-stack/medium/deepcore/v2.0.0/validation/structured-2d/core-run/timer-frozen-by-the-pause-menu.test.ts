// Deepcore — core-run/timer-frozen-by-the-pause-menu: the pause menu stops the
// clock, and resuming starts it again.
//
// `specs/hazards.md`: "The pause menu freezes the whole simulation, the timer
// with it, and resuming resumes it where it stopped." `specs/ui.md` calls the
// `paused` screen "The pause menu over the frozen, dimmed world."
//
// So a Sample is posed ticking, the game is put on the pause screen through the
// surface, and a span far longer than the one that follows is driven: the timer
// must not move. The game is then put back to `in-mine` and a measured span is
// driven: the timer must fall by exactly that span. Both readings are the one
// requirement — a build that froze the timer for good would pass the first alone,
// and is what the second is there to catch.
//
// The screen is posed rather than reached with the pause key, because this
// decides what the pause menu does to the simulation rather than which key opens
// it.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { elapse, openCampScene } from "./core-scene";

/** Far longer than the resumed span, so a timer that ran would be obvious. */
const PAUSED_SPAN = 6;

/** The span the resumed timer is measured over. */
const RESUMED_SPAN = 2;

/** Slack on a span read across whole frames. */
const TOLERANCE = 0.2;

/** Well short of `CORE_TIMER`, so neither span can run it out. */
const POSED_TIMER = CORE_TIMER - 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the Sample's timer while paused and runs it again on resuming", async () => {
  openCampScene(h);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(POSED_TIMER);

  const run = await captureReplay(h, "frozen", async () => {
    h.debug.setScreen("paused");
    const paused = h.snapshot();
    await elapse(h, PAUSED_SPAN);
    const held = h.snapshot();

    h.debug.setScreen("in-mine");
    await elapse(h, RESUMED_SPAN);
    const resumed = h.snapshot();

    return { paused, held, resumed };
  });

  assertEqual(run.paused.screen, "paused", "the screen the span was driven on");
  assertBetween(
    run.held.coreTimer ?? Number.NaN,
    (run.paused.coreTimer ?? Number.NaN) - TOLERANCE,
    (run.paused.coreTimer ?? Number.NaN) + TOLERANCE,
    `the timer after ${PAUSED_SPAN}s on the pause menu`,
  );

  assertBetween(
    (run.held.coreTimer ?? Number.NaN) - (run.resumed.coreTimer ?? Number.NaN),
    RESUMED_SPAN - TOLERANCE,
    RESUMED_SPAN + TOLERANCE,
    `seconds the timer fell over ${RESUMED_SPAN}s after resuming`,
  );
});

// Deepcore — core-run/timer-runs-in-a-panel: no screen hides from the timer.
//
// `specs/hazards.md`: "The timer counts down in game time and never pauses while
// the expedition runs, at the surface, inside a panel, or in the inventory."
// `specs/mining.md` says the same of the overlay: "The world holds still behind
// the overlay, but a live Core Sample's timer keeps running."
//
// So the same span of game time is driven three times over — once with no panel
// open, once with a building panel open, once with the inventory open — and the
// timer must fall by that span every time. The panels are opened through
// `setPanel`, which `specs/instrumentation.md` says opens one "wherever the miner
// stands", so this reads the timer rather than the route to a building.
//
// An eighth of a second either way covers the frame the span is divided into.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER } from "../../src/constants";
import { assertBetween } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { elapse, openCampScene } from "./core-scene";

/** The span each screen is held for. */
const SPAN = 2;

/** Slack on a span read across whole frames. */
const TOLERANCE = 0.2;

/** Well short of `CORE_TIMER`, so three spans cannot run it out. */
const POSED_TIMER = CORE_TIMER - 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("counts the Sample down at the surface, in a panel and in the inventory", async () => {
  openCampScene(h);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(POSED_TIMER);

  const run = await captureReplay(h, "ticking", async () => {
    const start = h.snapshot();
    await elapse(h, SPAN);
    const surface = h.snapshot();

    h.debug.setPanel("fuel-depot");
    await elapse(h, SPAN);
    const panel = h.snapshot();

    h.debug.setPanel("inventory");
    await elapse(h, SPAN);
    const inventory = h.snapshot();

    h.debug.setPanel(null);
    return { start, surface, panel, inventory };
  });

  const fall = (from: number | null, to: number | null): number =>
    (from ?? Number.NaN) - (to ?? Number.NaN);

  assertBetween(
    fall(run.start.coreTimer, run.surface.coreTimer),
    SPAN - TOLERANCE,
    SPAN + TOLERANCE,
    `seconds the timer fell over ${SPAN}s at the surface`,
  );
  assertBetween(
    fall(run.surface.coreTimer, run.panel.coreTimer),
    SPAN - TOLERANCE,
    SPAN + TOLERANCE,
    `seconds the timer fell over ${SPAN}s inside a building panel`,
  );
  assertBetween(
    fall(run.panel.coreTimer, run.inventory.coreTimer),
    SPAN - TOLERANCE,
    SPAN + TOLERANCE,
    `seconds the timer fell over ${SPAN}s inside the inventory`,
  );
});

// Deepcore — core-run/ignition-stops-the-timer: fabricating the Ignition Core
// ends the race.
//
// `specs/hazards.md`: "Installing the Ignition Core at the Launch Pad stops the
// timer and consumes the Sample." `specs/rocket.md` lists the Ignition Core last,
// costing `5000` Credits and one Core Sample, and says fabricating "stops the
// Core Sample timer, for the Ignition Core."
//
// So the four components before it are posed installed, a Sample is posed carried
// with its timer part run, the Credits are posed at exactly its price, and the
// Launch Pad's own `FABRICATE` is called through the control
// `specs/instrumentation.md` names. Afterwards the checklist must hold all five,
// the satchel must hold no Sample, and the timer must be gone — read again a
// moment later, because a timer that merely paused would start falling again.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER, ROCKET_COMPONENTS } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureReplay,
  createHarness,
  standAtBuilding,
  type Harness,
} from "../harness";
import { elapse, openCampScene } from "./core-scene";

/** The Ignition Core is the fifth entry on the checklist. */
const IGNITION = ROCKET_COMPONENTS[4];

/** Part run, so a timer left running would be visible as it fell further. */
const POSED_TIMER = CORE_TIMER - 20;

/** Driven after the fabrication, to catch a timer that only paused. */
const AFTER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("consumes the Sample and stops its timer when the Ignition Core is built", async () => {
  openCampScene(h);
  standAtBuilding(h, "launch-pad");
  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length - 1);
  h.debug.setCredits(IGNITION.credits);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(POSED_TIMER);
  h.debug.setPanel("launch-pad");

  const before = h.snapshot();
  assertEqual(
    before.rocket.nextComponent,
    IGNITION.id,
    "the component the pad offers next",
  );

  const after = await captureReplay(h, "install", async () => {
    h.debug.fabricate();
    const installed = h.snapshot();
    await elapse(h, AFTER);
    return { installed, later: h.snapshot() };
  });

  assertLength(
    after.installed.rocket.installed,
    ROCKET_COMPONENTS.length,
    "components on the checklist",
  );
  assertContains(
    after.installed.rocket.installed,
    IGNITION.id,
    "the checklist after the fabrication",
  );
  assertEqual(
    after.installed.satchel.coreSample,
    false,
    "a Sample still held after the fabrication",
  );
  assertNull(
    after.installed.coreTimer,
    "a timer still running after the fabrication",
  );
  assertNull(after.later.coreTimer, `a timer running again ${AFTER}s later`);
});

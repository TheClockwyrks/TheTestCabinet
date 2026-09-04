// Deepcore — core-run/saving-refused-while-a-sample-is-live: the pad will not
// bank a run with a Sample ticking.
//
// `specs/items.md`: "Saving is refused while a Core Sample's timer runs, whether
// the Sample is carried or lying jettisoned, so the timer is never frozen out by
// saving and quitting." `specs/expedition.md` repeats it among the save rules.
//
// The miner is stood at the Save Pad — whose footprint is asked of the build,
// since where the six buildings sit along the camp is the build's to choose — and
// the pad's own action is called through the control `specs/instrumentation.md`
// names for it, "as activating the Save Pad does". `hasSave` must stay `false`
// through both readings: once with the Sample in the satchel, and once with it
// dropped on the ground and still counting.
//
// The harness is given a REAL storage slot, so the refusal is the game's rule
// rather than a host with nowhere to write; the slot is cleared first, so
// `hasSave` starts from the state the refusal is measured against.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER } from "../constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureReplay,
  createHarness,
  standAtBuilding,
  type Harness,
} from "../harness";
import { openCampScene } from "./core-scene";

/** Frames each refusal is left on screen for, so the recording shows the note. */
const SHOWN_FRAMES = 60;

/** Far more than the drive takes, so neither reading is taken after a detonation. */
const POSED_TIMER = CORE_TIMER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("refuses to save while a Sample is carried or lying jettisoned", async () => {
  openCampScene(h);
  h.debug.clearSave();
  standAtBuilding(h, "save-pad");

  const start = h.snapshot();
  assertEqual(start.hasSave, false, "a save banked before the check");

  const run = await captureReplay(h, "refused", async () => {
    h.debug.setCoreCarried(true);
    h.debug.setCoreTimer(POSED_TIMER);
    h.debug.save();
    await h.advance(SHOWN_FRAMES);
    const carried = h.snapshot();

    h.debug.jettison();
    h.debug.save();
    await h.advance(SHOWN_FRAMES);
    const jettisoned = h.snapshot();

    return { carried, jettisoned };
  });

  assertNotNull(
    run.carried.coreTimer,
    "a timer running for the carried reading",
  );
  assertEqual(
    run.carried.hasSave,
    false,
    "a save banked while a Sample is carried",
  );

  assertNotNull(
    run.jettisoned.coreGround,
    "a Sample on the ground for the jettisoned reading",
  );
  assertEqual(
    run.jettisoned.hasSave,
    false,
    "a save banked while a Sample lies jettisoned",
  );
});

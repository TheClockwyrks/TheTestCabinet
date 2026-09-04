// save/save-excludes-a-live-sample — no save ever holds a live Core Sample.
//
// specs/expedition.md: "Saving is refused while a Core Sample's timer runs, carried
// or jettisoned", and specs/items.md repeats it, adding that "item counts are
// carried in the save; a live Core Sample never is". The consequence this check
// decides is the one a player meets: a restored expedition always opens with
// `coreTimer` null and nothing in the satchel's Sample slot, however the
// expedition that was restored from ended.
//
// TWO READINGS OF THE SAME RULE.
//
//   - The refusal. A save is banked cleanly at a marked Credits balance, a Sample
//     is then extracted and the save attempted again at a different balance. The
//     slot must still hold the FIRST balance, because the second save was refused
//     rather than taken.
//   - The restore. The expedition is then ended by a death in Standard, which
//     specs/modes.md says leaves the save intact and destroys a Sample held, and
//     the restored expedition is read for a Sample that is not there.
//
// ISOLATION. One Standard expedition on an empty mine with the slot cleared
// first, the miner standing at the camp, and its body and drill gated, since
// neither is what a Sample's timer or a save exercises.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { CORE_TIMER } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  bankSave,
  continueFromTitle,
  driveDeath,
  openAtCamp,
} from "./expedition";

/** The balance the clean save is taken at, and the one the refused save carries. */
const SAVED_CREDITS = 900;
const REFUSED_CREDITS = 4200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a save while a Sample is live, so a restore opens with none", async () => {
  await openAtCamp(h, { mode: "standard" });
  await h.debug.setCredits(SAVED_CREDITS);
  await bankSave(h);

  await h.debug.setCoreCarried(true);
  const carrying = await h.snapshot();
  assertEqual(
    carrying.satchel.coreSample,
    true,
    "specs/instrumentation.md: setCoreCarried(true) puts a Sample in the satchel",
  );
  assertEqual(
    carrying.coreTimer,
    CORE_TIMER,
    "specs/instrumentation.md: a Sample put there starts at CORE_TIMER",
  );

  await h.debug.setCredits(REFUSED_CREDITS);
  await h.debug.save();
  assertEqual(
    (await h.snapshot()).hasSave,
    true,
    "the earlier save is still in the slot",
  );

  const over = await driveDeath(h, "hull-destroyed");
  assertEqual(
    over.hasSave,
    true,
    "specs/modes.md: a Standard death leaves the save intact",
  );

  await continueFromTitle(h);
  await h.advance(1);

  const restored = await h.snapshot();
  await captureStill(h, "clean");
  assertEqual(
    restored.credits,
    SAVED_CREDITS,
    "specs/expedition.md: saving is refused while a Core Sample's timer runs",
  );
  assertNull(
    restored.coreTimer,
    "specs/items.md: a restored expedition opens with no Sample live",
  );
  assertEqual(
    restored.satchel.coreSample,
    false,
    "specs/items.md: a live Core Sample is never carried in the save",
  );
});

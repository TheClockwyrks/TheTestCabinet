// status-bar/status-control-states-live — each control reports the value it is currently reading.
//
// `specs/instrumentation.md` fixes `statusControls` as "the status bar's overlay,
// speed, pause, and mute controls, in the order they are drawn", each carrying a
// rectangle on the stage and a `state` that "reports the value the control is
// currently reading". `specs/hud.md` fixes that drawn order left to right — the
// combos toggle, the damage toggle, speed, pause, mute — which is `STATUS_ACTIONS`,
// and `specs/overview.md` puts the whole bar in `y` `0`–`56`.
//
// TWO CLAIMS, TWO POINTS. Where the controls are and what each of them currently
// reads are independent, and the validators of this project drive the pointer at
// these rectangles: a build that reports five honest rectangles and a stale state
// on each is a different defect from one that reports nothing at all, and it costs
// the player something different. `status-controls-reported` decides the presence,
// the order and the geometry; `status-control-states-live` decides the states.
//
// WHAT IS DECIDED HERE is that each `state` answers the value the game holds after
// that value is posed, one control at a time, so a failing grade names the control
// whose read went stale.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  statusControl,
  type Harness,
} from "../harness";
import { STATUS_ACTIONS } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The state `statusControls` reports for one action right now. */
async function stateOf(action: (typeof STATUS_ACTIONS)[number]) {
  return (await statusControl(h, action)).state;
}

it("reads its own live value on every one of the five controls", async () => {
  await openYard(h);
  await captureStill(h, "controls");

  // The overlay toggles read whether their overlay is open.
  assertEqual(await stateOf("combos"), false, "the combos state, book closed");
  assertEqual(await stateOf("damage"), false, "the damage state, board closed");
  await h.debug.setOverlay("combos", true);
  assertEqual(await stateOf("combos"), true, "the combos state, book open");
  assertEqual(
    await stateOf("damage"),
    false,
    "the damage state while only the book is open",
  );
  await h.debug.setOverlay("combos", false);
  await h.debug.setOverlay("damage", true);
  assertEqual(await stateOf("damage"), true, "the damage state, board open");
  await h.debug.setOverlay("damage", false);

  // Speed reads the live multiplier.
  assertEqual(await stateOf("speed"), 1, "the speed state at multiplier 1");
  await h.debug.setSpeed(4);
  assertEqual(await stateOf("speed"), 4, "the speed state at multiplier 4");

  // Pause reads the in-place pause.
  assertEqual(await stateOf("pause"), false, "the pause state while running");
  await h.debug.setPaused(true);
  assertEqual(await stateOf("pause"), true, "the pause state while paused");
  await h.debug.setPaused(false);

  // Mute reads the mute bit the snapshot also reports.
  assertEqual(await stateOf("mute"), false, "the mute state with audio on");
  await pressAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "snapshot().muted once the mute action has fired",
  );
  assertEqual(await stateOf("mute"), true, "the mute state with audio muted");
});

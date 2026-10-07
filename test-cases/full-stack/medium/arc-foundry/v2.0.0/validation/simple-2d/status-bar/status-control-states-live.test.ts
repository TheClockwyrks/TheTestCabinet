// status-bar/status-control-states-live — each control reports the value it is currently reading.
//
// `specs/instrumentation.md` fixes `statusControls` as "the status bar's overlay,
// speed, pause, and mute controls, in the order they are drawn", each carrying a
// rectangle on the stage and a `state` that "reports the value the control is
// currently reading". `specs/hud.md` fixes that drawn order left to right — the
// combos toggle, the damage toggle, speed, pause, mute — which is `STATUS_CONTROLS`,
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
import { STATUS_CONTROLS } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The state `statusControls` reports for one action right now. */
function stateOf(action: (typeof STATUS_CONTROLS)[number]) {
  return statusControl(h, action).state;
}

it("reads its own live value on every one of the five controls", async () => {
  openYard(h);
  // Every reading this point makes is taken through the surface, which under
  // an engine runs no frame, so the still is of the frame this one draws.
  await h.advance(1);
  captureStill(h, "controls");

  // The overlay toggles read whether their overlay is open.
  assertEqual(stateOf("combos"), false, "the combos state, book closed");
  assertEqual(stateOf("damage"), false, "the damage state, board closed");
  h.debug.setOverlay("combos", true);
  assertEqual(stateOf("combos"), true, "the combos state, book open");
  assertEqual(
    stateOf("damage"),
    false,
    "the damage state while only the book is open",
  );
  h.debug.setOverlay("combos", false);
  h.debug.setOverlay("damage", true);
  assertEqual(stateOf("damage"), true, "the damage state, board open");
  h.debug.setOverlay("damage", false);

  // Speed reads the live multiplier.
  assertEqual(stateOf("speed"), 1, "the speed state at multiplier 1");
  h.debug.setSpeed(4);
  assertEqual(stateOf("speed"), 4, "the speed state at multiplier 4");

  // Pause reads the in-place pause.
  assertEqual(stateOf("pause"), false, "the pause state while running");
  h.debug.setPaused(true);
  assertEqual(stateOf("pause"), true, "the pause state while paused");
  h.debug.setPaused(false);

  // Mute reads the mute bit the snapshot also reports.
  assertEqual(stateOf("mute"), false, "the mute state with audio on");
  await pressAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    true,
    "snapshot().muted once the mute action has fired",
  );
  assertEqual(stateOf("mute"), true, "the mute state with audio muted");
});

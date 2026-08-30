// status-bar/status-controls-reported — the five controls and the values they read.
//
// `specs/instrumentation.md` fixes `statusControls` as "the status bar's overlay,
// speed, pause, and mute controls, in the order they are drawn", each carrying a
// rectangle on the stage and a `state` that "reports the value the control is
// currently reading". `specs/hud.md` fixes that drawn order left to right — the
// combos toggle, the damage toggle, speed, pause, mute — which is `STATUS_CONTROLS`,
// and `specs/overview.md` puts the whole bar in `y` `0`–`56`.
//
// So the reading is held against the five things the specification fixes about
// it: the actions it names, the order it names them in, that each rectangle is a
// real region of the bar, that they run left to right, and that each `state`
// answers the value the game holds after that value is posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  statusControl,
  type Harness,
} from "../harness";
import { BAR_H, STAGE_W, STATUS_CONTROLS } from "../../src/constants";

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

it("reports the five controls, in order, each reading its own value", async () => {
  openYard(h);

  const controls = h.debug.statusControls();
  // Every reading this point makes is taken through the surface, which under
  // an engine runs no frame, so the still is of the frame this one draws.
  await h.advance(1);
  captureStill(h, "controls");

  assertDeepEqual(
    controls.map((c) => c.action),
    [...STATUS_CONTROLS],
    "the actions statusControls reports, in the order they are drawn",
  );

  let previous = -Infinity;
  for (const control of controls) {
    const where = `the \`${control.action}\` control's rectangle`;
    assertGreaterThan(control.w, 0, `${where} width`);
    assertGreaterThan(control.h, 0, `${where} height`);
    assertGreaterThanOrEqual(control.x, 0, `${where} left edge`);
    assertGreaterThanOrEqual(control.y, 0, `${where} top edge`);
    assertLessThanOrEqual(
      control.x + control.w,
      STAGE_W,
      `${where} right edge`,
    );
    assertLessThanOrEqual(control.y + control.h, BAR_H, `${where} bottom edge`);
    assertGreaterThanOrEqual(
      control.x,
      previous,
      `${where} left edge, against the control drawn before it`,
    );
    previous = control.x;
  }

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

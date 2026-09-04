// status-bar/status-controls-reported — the five controls, in order, each on a rectangle of the bar.
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
// WHAT IS DECIDED HERE is the reading held against the geometry the specification
// fixes about it: the actions it names, the order it names them in, that each
// rectangle is a real region of the bar, and that they run left to right.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BAR_H, STAGE_W, STATUS_CONTROLS } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports the five controls, in order, each on a rectangle of the bar", async () => {
  openYard(h);

  const controls = h.debug.statusControls();
  // Every reading this point makes is taken through the surface, which under
  // an engine runs no frame, so the still is of the frame this one draws.
  await h.advance(1);
  captureStill(h, "controls");

  assertDeepEqual(
    controls.map((c) => c.action),
    [...STATUS_CONTROLS],
    "the actions statusControls reports, in the order they are drawn " +
      "(specs/hud.md)",
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
});

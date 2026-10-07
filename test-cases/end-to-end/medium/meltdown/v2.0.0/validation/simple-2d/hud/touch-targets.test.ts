// hud/touch-targets — every control the panel offers is at least
// `MIN_TOUCH_TARGET` on both sides and lies inside the panel's strip.
//
// THE RULE. specs/hud.md, Touch targets: "Every control the panel carries is at
// least `MIN_TOUCH_TARGET` (`32`) by `32` logical units and lies inside the
// panel's strip." specs/floor.md fixes that strip: `x` from `PANEL_X` (`986`) to
// the stage's right edge, the full height of the stage, and "no panel readout or
// control is drawn on the floor". specs/overview.md's hard requirements say why
// it matters: the game is played "with the pointer and with a touchscreen", and
// every action is reachable by pointer alone.
//
// EVERY CONTROL MEANS EVERY CONTROL, SO TWO STATES ARE POSED. specs/hud.md draws
// Rotate and Cancel "only while a preview is held" and specs/instrumentation.md
// reports them as `null` otherwise; Upgrade and Sell are drawn only on a selected
// tower and reported as `null` otherwise. So one pose holds a preview and the
// other selects a tower, and between them all fourteen rectangles the panel can
// report are measured. Each pose also reads back that the four conditional
// controls really are offered in the state that offers them, because a control
// the panel never draws would otherwise pass this point by being absent.
//
// THE MEASUREMENT IS OF THE RECTANGLES THE BUILD ITSELF REPORTED, which is the
// whole reason the `controls` block exists: it lets specs/hud.md require a Rotate
// control, a Send control and a mute control without fixing where any of them
// sits, and it is what a scripted press aims at (specs/instrumentation.md,
// `controls`). A build whose reported rectangle is smaller than what it drew has
// reported the target a finger has to hit, which is the figure the specification
// is about.
//
// BOTH HALVES OF THE RULE ARE READ ON EVERY RECTANGLE, and they fail differently:
// a control that is big enough but hangs off the edge of the strip is drawn over
// the floor, which specs/floor.md forbids, and one that sits neatly inside but is
// twenty units tall is a target a thumb misses.
//
// WHAT IT DOES NOT DECIDE. That pressing each control does its action is the
// `controls` group's, and that the panel occupies its strip at all is
// `floor.panel-strip`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { MIN_TOUCH_TARGET, PANEL_X, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  poseTower,
  startRun,
  type ControlsSnapshot,
  type Harness,
  type RectSnapshot,
} from "../harness";

/** The type armed for the first pose, and the tower posed for the second. */
const ARMED = "arc";
const PLACED = "bloom";

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/** Where the held preview is put: a quiet tile well clear of the anchor above. */
const PREVIEW_AT = { col: 24, row: 8 };

/** Far above every build cost, so nothing about the purse changes what the panel
 * offers. */
const PURSE = 9999;

/** Measure every rectangle a pose reported, naming the pose in each failure. */
function measure(controls: ControlsSnapshot, posed: string): void {
  const named: [string, RectSnapshot][] = [
    ...controls.shop.map((entry): [string, RectSnapshot] => [
      `the ${entry.type} shop entry`,
      entry,
    ]),
    ...(controls.rotate === null
      ? []
      : ([["the Rotate control", controls.rotate]] as [
          string,
          RectSnapshot,
        ][])),
    ...(controls.cancel === null
      ? []
      : ([["the Cancel control", controls.cancel]] as [
          string,
          RectSnapshot,
        ][])),
    ...(controls.upgrade === null
      ? []
      : ([["the Upgrade action", controls.upgrade]] as [
          string,
          RectSnapshot,
        ][])),
    ...(controls.sell === null
      ? []
      : ([["the Sell action", controls.sell]] as [string, RectSnapshot][])),
    ["the Send control", controls.send],
    ["the game-speed toggle", controls.speed],
    ["the Pause control", controls.pause],
    ["the mute control", controls.mute],
  ];

  for (const [name, rect] of named) {
    const where = `${name}, ${posed} (specs/hud.md, Touch targets)`;
    assertGreaterThanOrEqual(rect.w, MIN_TOUCH_TARGET, `the width of ${where}`);
    assertGreaterThanOrEqual(
      rect.h,
      MIN_TOUCH_TARGET,
      `the height of ${where}`,
    );
    assertGreaterThanOrEqual(
      rect.x,
      PANEL_X,
      `the left edge of ${where}, against the panel strip that starts at ` +
        `PANEL_X (specs/floor.md, The two regions)`,
    );
    assertLessThanOrEqual(
      rect.x + rect.w,
      STAGE_W,
      `the right edge of ${where}, against the stage's own edge ` +
        `(specs/floor.md)`,
    );
    assertGreaterThanOrEqual(
      rect.y,
      0,
      `the top edge of ${where}, against the top of the stage (specs/floor.md)`,
    );
    assertLessThanOrEqual(
      rect.y + rect.h,
      STAGE_H,
      `the bottom edge of ${where}, against the bottom of the stage ` +
        `(specs/floor.md)`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every control at a tappable size, inside the panel's strip", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  h.debug.setArmed(ARMED);
  h.debug.setPreview(PREVIEW_AT.col, PREVIEW_AT.row);
  await drawFrame(h);
  captureStill(h, "targets");
  const armed = h.snapshot().controls;

  assertNotNull(
    armed.rotate,
    "a hit rectangle for the Rotate control while a preview is held, which " +
      "specs/hud.md draws in exactly that state (specs/instrumentation.md, " +
      "controls)",
  );
  assertNotNull(
    armed.cancel,
    "a hit rectangle for the Cancel control while a preview is held, which " +
      "specs/hud.md draws in exactly that state (specs/instrumentation.md, " +
      "controls)",
  );
  measure(armed, "with a placement armed");

  h.debug.setArmed(null);
  const id = poseTower(h, PLACED, AT.col, AT.row);
  h.debug.setSelected(id);
  await drawFrame(h);
  const selected = h.snapshot().controls;

  assertNotNull(
    selected.upgrade,
    "a hit rectangle for the Upgrade action on a selected tower, which " +
      "specs/hud.md draws in exactly that state (specs/instrumentation.md, " +
      "controls)",
  );
  assertNotNull(
    selected.sell,
    "a hit rectangle for the Sell action on a selected tower, which " +
      "specs/hud.md draws in exactly that state (specs/instrumentation.md, " +
      "controls)",
  );
  measure(selected, "with a tower selected");
});

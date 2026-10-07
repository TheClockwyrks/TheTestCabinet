// status-bar/status-controls-on-paused — the reading follows the bar being drawn.
//
// `specs/hud.md`: the bar and the panel "are drawn on the two screens the yard is
// shown on, `playing` and `paused`, and on no other screen. On `paused` both are
// drawn and both read their live values". `specs/ui.md` puts the pause menu "over
// a yard that is visible and frozen behind it", and gives the two result screens
// the opposite: "The yard is not shown behind it, so the status bar and the build
// panel of `specs/hud.md` are not drawn." `specs/instrumentation.md` binds the
// reading to that: `statusControls` and its siblings "each return an empty array
// on every other screen", and on `paused` "all three report what is drawn: each
// `state` reads its live value".
//
// SO THIS IS ONE BEHAVIOUR READ AT ITS BOUNDARY, IN BOTH DIRECTIONS. A build that
// keys the reading on "is this a menu screen" rather than on "is the yard shown"
// answers nothing on the paused screen, where the bar is right there behind the
// menu, and a reviewer's automation loses every control the moment the game is
// paused. `status-controls-reported` reads the bar on `playing` and cannot see
// that.
//
// THE LIVE VALUES ARE PART OF IT. The pause is posed with the speed at 4 and the
// recipe book open, so a build that reports a frozen or default row rather than
// the value the control is reading fails here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  statusControl,
  type Harness,
} from "../harness";
import { STATUS_ACTIONS } from "../constants";

/** A multiplier that is not the resting `1`, so a default row is told apart. */
const SPEED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the bar behind the pause menu, and nothing on a result screen", async () => {
  await openYard(h, { speed: SPEED });
  await h.debug.setOverlay("combos", true);

  const playing = await h.debug.statusControls();
  await h.debug.setScreen("paused");
  const paused = await h.debug.statusControls();
  await h.advance(1);
  await captureStill(h, "paused");

  assertDeepEqual(
    paused.map((c) => c.action),
    [...STATUS_ACTIONS],
    "the actions statusControls reports on the paused screen, where the yard " +
      "is visible and frozen behind the menu (specs/ui.md, specs/hud.md)",
  );
  assertDeepEqual(
    paused.map((c) => [c.x, c.y, c.w, c.h]),
    playing.map((c) => [c.x, c.y, c.w, c.h]),
    "the rectangles the paused bar reports, against the ones it reported " +
      "while the game was running",
  );

  assertEqual(
    (await statusControl(h, "speed")).state,
    SPEED,
    "the speed control's live multiplier, read on the paused screen",
  );
  assertEqual(
    (await statusControl(h, "combos")).state,
    true,
    "the combos control's live state, read on the paused screen",
  );
  assertEqual(
    (await statusControl(h, "pause")).state,
    false,
    "the pause control's state, which reads the in-place pause and not the " +
      "pause menu (specs/hud.md)",
  );

  // The other side of the same rule: no yard, so no bar, so nothing reported.
  await h.debug.setScreen("victory");
  assertLength(
    await h.debug.statusControls(),
    0,
    "statusControls on the victory screen, which shows no yard and so draws " +
      "no status bar (specs/ui.md)",
  );
  await h.debug.setScreen("overload");
  assertLength(
    await h.debug.statusControls(),
    0,
    "statusControls on the overload screen, which shows no yard and so draws " +
      "no status bar (specs/ui.md)",
  );
});

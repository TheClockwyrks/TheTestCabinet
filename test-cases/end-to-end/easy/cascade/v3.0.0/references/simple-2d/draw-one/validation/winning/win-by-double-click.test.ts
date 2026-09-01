// winning/win-by-double-click — double-clicking the last card home wins the game.
//
// THE RULE. specs/victory.md: the win "is reached by whatever move put the last
// card home, whether a released drop or a double click". specs/controls.md fixes
// the gesture: a press is a double click when it arrives within
// `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous press, within
// `DOUBLE_CLICK_SLOP` (`20`) of its point, and on a playable card; "sending a card
// home this way is a move like any other, so it turns a newly exposed column card
// and it can win the game".
//
// This is the second of the two gestures the win is reachable by, and it is its own
// point for the reason `winning/win-by-drop` is: a build can carry a card home with
// the pointer and never send one home with two clicks, or the reverse, and the two
// faults have to grade apart.
//
// THE SECOND PRESS IS WHAT WINS, and the reading is taken there. specs/controls.md
// puts the auto-move on the press — "a double click lifts nothing. Instead the card
// under it is sent to the foundation it belongs on ... and the gesture ends there;
// the release that follows changes nothing" — so the screen is read straight after
// the second `pointerDown`, with no frame advanced and no release issued. The first
// click is read too, and it has to leave the game on `playing` with the card back
// on its column: it lifts the run and returns it (specs/controls.md), and a build
// that sent the card home on a SINGLE click would win there and fail naming the
// click it won on.
//
// THE TWO PRESSES ARE ONE FRAME APART, `1/240` s of game time, which is far inside
// the window, and at the same point, which is `0` units of slop. The window and the
// slop are `handling/slow-second-press-does-not` and
// `handling/far-second-press-does-not`; nothing here is measuring either, so both
// are driven far from their edges and neither figure is asserted.
//
// AND THE CASCADE IS RUNNING ONCE THE PRESS HAS BEEN HANDLED. specs/victory.md:
// "The victory cascade begins with the win." The frames after the press are run and
// the launch counter has to have moved. How soon is `winning/cascade-begins-on-win`
// and how fast is `cascade/launch-cadence`; this point asks only that it is under
// way.
//
// The trail is left painting, for the reason `winning/win-by-drop` states: the
// recording covers the win and the cascade's first fractions of a second, and the
// trail is most of what there is to look at.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, LAUNCH_INTERVAL } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  openTable,
  poseNearlyWon,
  pressPoint,
  type Harness,
} from "../harness";

/**
 * Frames of the nearly-won board recorded before the gesture starts.
 *
 * Evidence rather than measurement, as in `winning/win-by-drop`: nothing moves over
 * them.
 */
const LEAD_FRAMES = 12;

/**
 * Frames between the two clicks.
 *
 * One, so the first click's effect is a frame the recording carries. At the suite's
 * 240 Hz that is `1/240` s of game time between the two presses, about a
 * seventieth of `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so the second
 * press is unambiguously inside the window and no build meeting the window can miss
 * it.
 */
const CLICK_GAP_FRAMES = 1;

/**
 * How long the cascade is watched after the second press, in frames.
 *
 * Two launch intervals (`LAUNCH_INTERVAL` is `0.18` s, specs/victory.md), for the
 * reason `winning/win-by-drop` states: a build launching its first card anywhere
 * inside the first interval crosses this span with a card away.
 */
const CASCADE_FRAMES = framesFor(2 * LAUNCH_INTERVAL);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("wins the game on the second press of a double click on the last card", async () => {
  openTable(harness);
  const pending = poseNearlyWon(harness);

  const posed = harness.snapshot();
  assertLength(
    posed.foundations.flat(),
    DECK_SIZE - 1,
    "cards on the foundations before the double click, which leaves exactly " +
      "one to send home (specs/victory.md)",
  );
  const at = pressPoint(
    posed,
    pending.from.pile,
    pending.from.index,
    pending.from.row,
  );

  const gesture = await captureReplay(harness, "double-click", async () => {
    await harness.advance(LEAD_FRAMES);

    harness.debug.pointerDown(at.x, at.y);
    harness.debug.pointerUp(at.x, at.y);
    await harness.advance(CLICK_GAP_FRAMES);
    const clicked = harness.snapshot();

    harness.debug.pointerDown(at.x, at.y);
    const pressed = harness.snapshot();

    await harness.advance(CASCADE_FRAMES);
    return { clicked, pressed, after: harness.snapshot() };
  });

  assertEqual(
    gesture.clicked.screen,
    "playing",
    "the screen after ONE click on the last card, which lifts the card and " +
      "returns it and sends nothing home (specs/controls.md)",
  );
  assertLength(
    gesture.clicked.foundations.flat(),
    DECK_SIZE - 1,
    "cards on the foundations after that single click (specs/controls.md)",
  );
  assertEqual(
    gesture.pressed.screen,
    "won",
    "the screen the second press of the double click left, read on the press " +
      "itself with no frame advanced (specs/controls.md, specs/victory.md)",
  );
  assertLength(
    gesture.pressed.foundations.flat(),
    DECK_SIZE,
    "cards on the foundations once the double click had sent the last one " +
      "home (specs/victory.md)",
  );
  assertGreaterThanOrEqual(
    gesture.after.launched,
    1,
    `cards the cascade had launched ${String(CASCADE_FRAMES)} frames after ` +
      "the second press was handled, the cascade beginning with the win " +
      "(specs/victory.md)",
  );
});

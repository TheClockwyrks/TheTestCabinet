// instrumentation/reset-restores-title — `reset` returns every declared field to
// its title value, and leaves the mute bit alone.
//
// specs/instrumentation.md lists the title values `reset` restores, one by one:
// `screen` `"title"`; all thirteen piles and the waste's set memory emptied; the
// run in hand, the drop target and the last press cleared; the pointer at `(0, 0)`
// and up; `autoFlip`, `winDetect`, `launching` and `trailPainting` back on;
// `launchClock` `0`, `launched` `0` and `cascadeDone` `false`; every flyer removed;
// the painted layer cleared and `trailStamps` `0`; and `simTime` `0`.
//
// WHY IT MATTERS BEYOND ITS OWN POINT. `reset` is the operation that makes a
// scenario reproducible: `openTable` in `harness.ts` opens every scenario in this
// project with it, and a `reset` that leaves a card, a flyer or a gate behind
// carries one scenario into the next.
//
// THE BOARD IT IS ASKED TO GIVE BACK IS A REAL ONE. A cascade is entered through
// the game's own win path and run for a quarter of a second, so cards have
// launched, cards are in flight, the painted layer has taken stamps and `simTime`
// has accumulated: every one of those fields is plainly NOT at its title value when
// the reset is called. The screen is then posed back to `playing` to hold a run in
// hand, because a press on the `won` screen deals a fresh game (specs/victory.md)
// and would wipe the board this point is asking to be given back.
//
// `cascadeDone` IS THE ONE FIELD POSED AT ITS TITLE VALUE, and knowingly. It is set
// by the cascade's own end test, which needs all fifty-two cards launched and none
// in flight (specs/instrumentation.md), and there is no operation that poses it. It
// is asserted for completeness of the list rather than as a reading that could have
// been anything else.
//
// MUTE IS THE ONE EXCEPTION, AND IT IS READ RATHER THAN REQUIRED.
// specs/instrumentation.md leaves `muted` exactly as it stands, because muting is a
// player preference the runtime owns. A check made on a game that was never muted
// would pass whatever `reset` did to the bit, so this one drives the real `SOUND`
// control first, which is the only route there is since there is no `setMuted`,
// reads whatever bit that produced, and requires the reset to hand back the same
// bit. Whether the control works at all is `screens.hud-sound-toggles`'s point, so
// what is asserted is the equality and never the value.
//
// THE READING IS TAKEN BEFORE THE STILL'S FRAME. `simTime` is `0` immediately after
// the reset and one frame's delta after the frame that draws the title, so the
// snapshot is read first and the frame is run after it.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_SOUND } from "../../src/constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  poseColumn,
  posePile,
  poseWaste,
  pressPoint,
  startCascade,
  type Harness,
} from "../harness";
import { EVERY_PILE, pileName } from "./board";

/** Where the `SOUND` control is pressed: the middle of its own rectangle. */
const SOUND_X = HUD_SOUND.x + HUD_SOUND.w / 2;
const SOUND_Y = HUD_SOUND.y + HUD_SOUND.h / 2;

/**
 * How long the cascade is left to run before the reset.
 *
 * A quarter of a second, which is past the first two launches at
 * `LAUNCH_INTERVAL` (`0.18` s) and leaves both cards in flight, so `launched`,
 * `flyers`, `trailStamps` and `simTime` are all plainly away from their title
 * values when the reset is called.
 */
const CASCADE_FRAMES = framesFor(0.25);

/** The cards posed back onto the table before the reset, so no pile is empty. */
const STOCK = ["#2C", "#3C"];
const WASTE = ["4H", "5H"];
const WASTE_SETS = [1, 1];
const COLUMN = 0;
const COLUMN_CARDS = ["#7S", "KD"];

/** The launch clock posed before the reset: neither `0` nor a whole interval. */
const LAUNCH_CLOCK = 0.11;

/** Six decimal places: float noise, not a rounding a build may choose. */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every title value and leaves muted as it stands", async () => {
  // Mute first, through the HUD control specs/screens.md fixes, because that is
  // the only route to the bit: there is no `setMuted` (specs/instrumentation.md).
  // One frame runs after the click so the game's copy and the engine's bus agree.
  openTable(h);
  clickAt(h, SOUND_X, SOUND_Y);
  await h.advance(1);
  const mutedBefore = h.snapshot().muted;

  // A game won and a cascade running: cards launched, cards in flight, a painted
  // layer and accumulated time.
  startCascade(h);
  await h.advance(CASCADE_FRAMES);

  // Back to the table, so a run can be held: a press on the won screen deals.
  h.debug.setScreen("playing");
  posePile(h, "stock", 0, STOCK);
  poseWaste(h, WASTE, WASTE_SETS);
  poseColumn(h, COLUMN, COLUMN_CARDS);
  const grab = pressPoint(h.snapshot(), "tableau", COLUMN, 1);
  h.debug.pointerDown(grab.x, grab.y);
  h.debug.pointerMove(grab.x + 40, grab.y + 40);

  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);
  h.debug.setLaunchClock(LAUNCH_CLOCK);

  // The board the reset is asked to give back is plainly not the title's.
  const dirty = h.snapshot();
  assertGreaterThan(dirty.launched, 0, "cards the cascade launched");
  assertGreaterThan(dirty.flyers.length, 0, "cards in flight");
  assertGreaterThan(dirty.trailStamps, 0, "stamps on the painted layer");
  assertGreaterThan(dirty.simTime, 0, "the game time that has accumulated");
  assertNotNull(dirty.drag, "the run in hand");

  h.debug.reset();
  const title = h.snapshot();

  // The title screen the reset returned to.
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(title.screen, "title", "reset restores screen");

  for (const ref of EVERY_PILE) {
    assertLength(
      pileOf(title, ref.pile, ref.index),
      0,
      `reset empties ${pileName(ref)}`,
    );
  }
  assertLength(title.wasteSets, 0, "reset empties the waste's set memory");

  assertNull(title.drag, "reset clears the run in hand");
  assertNull(title.dropTarget, "reset clears the drop target");
  assertNull(title.lastPress, "reset clears the last press");
  assertCloseTo(title.pointer.x, 0, EXACT, "reset puts the pointer at x 0");
  assertCloseTo(title.pointer.y, 0, EXACT, "reset puts the pointer at y 0");
  assertEqual(title.pointer.down, false, "reset leaves the pointer up");

  assertEqual(title.autoFlip, true, "reset turns autoFlip back on");
  assertEqual(title.winDetect, true, "reset turns winDetect back on");
  assertEqual(title.launching, true, "reset turns launching back on");
  assertEqual(title.trailPainting, true, "reset turns trailPainting back on");

  assertCloseTo(title.launchClock, 0, EXACT, "reset clears the launch clock");
  assertEqual(title.launched, 0, "reset returns launched to zero");
  assertEqual(title.cascadeDone, false, "reset clears the cascade's end flag");
  assertLength(title.flyers, 0, "reset removes every flyer");
  assertEqual(title.trailStamps, 0, "reset clears the painted layer's stamps");
  assertCloseTo(title.simTime, 0, EXACT, "reset returns simTime to zero");

  // And the one field it must NOT touch.
  assertEqual(
    title.muted,
    mutedBefore,
    "reset leaves muted exactly as it stands: muting is a player preference " +
      "the runtime owns (specs/instrumentation.md)",
  );
});

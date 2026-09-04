// audio/mute-silences — while sound is muted, no cue is audible.
//
// specs/audio.md fixes the requirement: "Muting belongs to the engine... The HUD's
// `SOUND` control toggles the engine's mute bit. While sound is muted every cue is
// silent and the game stays fully playable." specs/screens.md gives that control
// its place in the HUD and specs/controls.md its rectangle, and
// specs/instrumentation.md reports the result as the snapshot's `muted`, the game's
// copy of the runtime's bit refreshed in every update. No pose sets it, so the mute
// is reached here the way a player reaches it: by clicking the control.
//
// SILENCE IS A GAIN OF ZERO, NOT A MISSING ANNOUNCEMENT. Muting belongs to the
// engine's audio bus, and the bus announces a play whether or not anything can be
// heard, carrying the gain it sounded at: zero while muted, positive otherwise.
// That is what separates a build that went quiet from one that stopped reacting,
// and it is why this point reads GAIN across the muted window rather than counting
// announcements. A build that suppresses its own plays while muted is silent too,
// and passes on the same reading.
//
// THREE EVENTS, FROM THREE CORNERS OF THE GAME. A turn of the stock, a press that
// lifts a run, and a release a column accepts. Each is driven through the game's own
// path and each is checked to have actually happened, so the silence this point
// reports is the silence of a working game rather than of a broken one —
// specs/audio.md requires that the game "stays fully playable" while muted, and a
// build that answered the mute by ignoring the player would be silent for the wrong
// reason. `audio/cue-turn`, `audio/cue-lift` and `audio/cue-drop` decide that each
// of the three sounds its cue when the game is NOT muted; this point decides that
// none of them is audible when it is.
//
// THE MUTED WINDOW COVERS EVERYTHING AFTER THE CLICK. Every cue the bus announced
// from the `SOUND` click onward is read, whatever its name, so a build that
// silences the three cues this point drives and leaves some fourth one audible is
// caught here too.
//
// WHAT THIS DOES NOT DECIDE. That the `SOUND` control is drawn and labelled, and
// that clicking it flips the reported bit, are `screens/hud-labels-drawn`'s and
// `screens/hud-sound-toggles`'s requirements. This point reads what the mute did to
// the sound.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import {
  DOUBLE_CLICK_WINDOW,
  HUD_SOUND,
  STOCK_X,
  TOP_ROW_Y,
} from "../constants";
import {
  captureStill,
  cardCenter,
  createHarness,
  framesFor,
  openTable,
  placeOf,
  poseColumn,
  poseStock,
  pressPoint,
  releasePoint,
  tapPointer,
  watchCues,
  type Harness,
} from "../harness";
import { audibleAfter, centerOf, pressFrame, releaseFrame } from "./cues";

/**
 * Frames driven between one gesture and the next.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so each press below
 * falls outside the window the one before it is measured against and none of them
 * pairs into a double click. Nothing else happens across these frames, so they are
 * part of the silence this point reads.
 */
const GAP = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The stock this scenario stands on: seven face-down cards.
 *
 * More than the three a Draw Three turn moves (specs/stock.md), so the click below
 * is an ordinary turn of a stock that still holds cards under either deal mode.
 */
const STOCK = ["#2C", "#3C", "#4C", "#5C", "#6C", "#7C", "#8C"];

/** The run that is carried, and the column that takes it (specs/tableau.md). */
const RUN = "5H";
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TARGET = "6S";
const TO_COLUMN = 1;

/** A point inside each rectangle the gestures below press (specs/controls.md). */
const SOUND = centerOf(HUD_SOUND);
const STOCK_POINT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds nothing at all once the SOUND control has muted the game, through a turn, a lift and a drop", async () => {
  const cues = watchCues(h);
  openTable(h);
  poseStock(h, STOCK);
  const [run] = poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game opens unmuted, so the SOUND click below turns muting " +
      "on rather than off (specs/audio.md)",
  );

  await tapPointer(h, SOUND.x, SOUND.y);
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit the snapshot reports after one click inside the HUD's " +
      "SOUND rectangle (specs/audio.md, specs/screens.md)",
  );

  // Everything the bus announces from here on is read, whatever its name.
  const mark = cues.length;
  await h.advance(GAP);

  // One turn of the stock.
  await tapPointer(h, STOCK_POINT.x, STOCK_POINT.y);
  assertGreaterThan(
    h.snapshot().waste.length,
    0,
    "cards on the waste after the click inside the stock's rectangle, so the " +
      "muted game still turns its stock (specs/stock.md, specs/audio.md: the " +
      "game stays fully playable)",
  );
  await h.advance(GAP);

  // One press that lifts a run.
  await pressFrame(
    h,
    pressPoint(h.snapshot(), "tableau", FROM_COLUMN, FROM_ROW),
  );
  assertNotNull(
    h.snapshot().drag,
    `the run in hand after the press on the ${RUN}, so the muted game still ` +
      "lifts a run (specs/controls.md, specs/audio.md)",
  );

  // One release a column accepts.
  await releaseFrame(h, releasePoint(h.snapshot(), "tableau", TO_COLUMN));
  captureStill(h, "muted");
  const landed = placeOf(h.snapshot(), run);
  assertDeepEqual(
    landed === null ? null : { pile: landed.pile, index: landed.index },
    { pile: "tableau", index: TO_COLUMN },
    `the pile holding the ${RUN} after it was released over the ${TARGET}, so ` +
      "the muted game still completes a move (specs/tableau.md, " +
      "specs/audio.md)",
  );

  assertDeepEqual(
    audibleAfter(cues, mark),
    [],
    "the cues that sounded at an audible gain after the game was muted, " +
      "across a stock turn, a lift and an accepted drop (specs/audio.md: " +
      "while sound is muted every cue is silent)",
  );
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit the snapshot reports after the three events, which nothing " +
      "but the SOUND control changes (specs/audio.md)",
  );
});

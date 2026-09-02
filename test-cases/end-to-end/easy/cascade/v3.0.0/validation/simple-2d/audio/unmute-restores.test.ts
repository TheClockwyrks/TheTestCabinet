// audio/unmute-restores — with mute turned off again, the cue is audible.
//
// specs/audio.md fixes the requirement: "While sound is muted every cue is silent
// and the game stays fully playable, and turning mute off makes the same cues
// audible again." specs/screens.md gives the HUD's `SOUND` control the toggling of
// that bit and specs/controls.md its rectangle, so the mute is turned on and off
// here the way a player turns it: by clicking the control twice.
//
// So the measurement is: mute, turn the stock once under the mute, unmute, and turn
// the stock again — the SAME event, on the same table — then read the gain the cue
// sounded at on the second turn's frame. The engine's bus announces a play whether
// or not anything can be heard, carrying zero while muted and its own level
// otherwise, so "audible" is a positive gain rather than the mere fact of an
// announcement.
//
// THIS IS THE OTHER DIRECTION FROM `audio/mute-silences`, AND ITS OWN POINT. A build
// whose `SOUND` control mutes but never unmutes silences the game correctly and
// never gives the sound back, and one whose control does nothing at all leaves
// everything audible; the two are different defects and must grade differently. So
// this point asserts only that the cue is audible with the mute off, and says
// nothing about what happened while it was on.
//
// THE FIRST TURN IS THE "AGAIN". It puts the same event through the same path while
// the game is muted, so what the second turn restores is a cue this scenario has
// already asked for once. Its silence is `audio/mute-silences`'s reading, not this
// point's, and nothing here asserts it.
//
// THE STOCK NEVER EMPTIES. Seven cards is more than two Draw Three turns take, so
// both clicks are ordinary turns of a stock that still holds cards under either
// deal mode, and neither is the recycle a turn of an empty stock performs
// (specs/stock.md).
//
// WHAT THIS DOES NOT DECIDE. That the `SOUND` control is drawn and labelled, and
// that clicking it flips the reported bit, are `screens/hud-labels-drawn`'s and
// `screens/hud-sound-toggles`'s requirements. This point reads what the unmute gave
// back to the sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  CUES,
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
  poseStock,
  tapPointer,
  watchCues,
  type Harness,
} from "../harness";
import { audibleOn, centerOf } from "./cues";

/**
 * Frames driven between one click and the next.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so each press below
 * falls outside the window the one before it is measured against and no two of them
 * pair into a double click.
 */
const GAP = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The stock this scenario stands on: seven face-down cards.
 *
 * More than the six two Draw Three turns take (specs/stock.md), so both clicks are
 * turns of a stock that still holds cards under either deal mode.
 */
const STOCK = ["#2C", "#3C", "#4C", "#5C", "#6C", "#7C", "#8C"];

/** A point inside each rectangle the clicks below press (specs/controls.md). */
const SOUND = centerOf(HUD_SOUND);
const STOCK_POINT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.turn at an audible gain on the frame of a turn made after the SOUND control unmuted the game", async () => {
  const cues = watchCues(h);
  openTable(h);
  poseStock(h, STOCK);

  await tapPointer(h, SOUND.x, SOUND.y);
  assertEqual(
    h.snapshot().muted,
    true,
    "posing: the mute bit the snapshot reports after the first SOUND click, " +
      "which is the muting this point then asks the second click to undo " +
      "(specs/audio.md, specs/screens.md)",
  );
  await h.advance(GAP);

  // The same event, once under the mute.
  await tapPointer(h, STOCK_POINT.x, STOCK_POINT.y);
  const muted = h.snapshot().waste.length;
  assertGreaterThan(
    muted,
    0,
    "cards on the waste after the first click inside the stock's rectangle, " +
      "so the muted game still turns its stock (specs/stock.md)",
  );
  await h.advance(GAP);

  await tapPointer(h, SOUND.x, SOUND.y);
  assertEqual(
    h.snapshot().muted,
    false,
    "the mute bit the snapshot reports after the second SOUND click, which " +
      "turns muting off again (specs/audio.md, specs/screens.md)",
  );
  await h.advance(GAP);

  // The same event again, with the mute off.
  await tapPointer(h, STOCK_POINT.x, STOCK_POINT.y);
  const at = h.engine.frame().count;
  captureStill(h, "unmuted");

  assertGreaterThan(
    h.snapshot().waste.length,
    muted,
    "cards on the waste after the second click inside the stock's rectangle, " +
      "which is the turn whose cue this point reads (specs/stock.md)",
  );
  assertEqual(
    audibleOn(cues, at, CUES.turn),
    1,
    "times CUES.turn played at an audible gain on the frame of the turn made " +
      "after the SOUND control unmuted the game (specs/audio.md: turning mute " +
      "off makes the same cues audible again)",
  );
});

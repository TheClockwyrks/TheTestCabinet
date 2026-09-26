// audio/mute-silences — while sound is muted, no cue is audible.
//
// specs/audio.md fixes the requirement: "Muting belongs to the engine... The HUD's
// `SOUND` control toggles the engine's mute bit. While sound is muted every cue is
// silent and the game stays fully playable." specs/screens.md gives that control
// its place in the HUD and specs/controls.md its rectangle, and
// specs/instrumentation.md reports the result as the snapshot's `muted`, the
// game's copy of the runtime's bit refreshed in every update. No operation sets
// it, so the mute is reached here the way a player reaches it: by clicking the
// control.
//
// SILENCE IS A GAIN OF ZERO, NOT A MISSING ANNOUNCEMENT. Muting belongs to the
// engine's audio bus, and the bus announces a play whether or not anything can be
// heard, carrying the gain it sounded at: zero while muted, positive otherwise.
// That is what separates a build that went quiet from one that stopped reacting,
// and it is why this point reads GAIN across the muted window rather than
// counting announcements. A build that suppresses its own plays while muted is
// silent too, and passes on the same reading.
//
// THREE EVENTS, FROM THREE CORNERS OF THE GAME. A turn of the stock, a press that
// lifts a run, and a release a column accepts. Each is driven through the game's
// own path and each is checked to have actually happened, so the silence this
// point reports is the silence of a working game rather than of a broken one —
// specs/audio.md requires that the game "stays fully playable" while muted, and a
// build that answered the mute by ignoring the player would be silent for the
// wrong reason. `audio/cue-turn`, `audio/cue-lift` and `audio/cue-drop` decide
// that each of the three sounds its cue when the game is NOT muted; this point
// decides that none of them is audible when it is.
//
// THE MUTED WINDOW COVERS EVERYTHING AFTER THE CLICK. Every cue the bus announced
// from the `SOUND` click onward is read, whatever its name, so a build that
// silences the three cues this point drives and leaves some fourth one audible is
// caught here too.
//
// WHAT THIS DOES NOT DECIDE. That the `SOUND` control is drawn and labelled, and
// that clicking it flips the reported bit, are `screens/hud-labels-drawn`'s and
// `screens/hud-sound-mutes`'s requirements. This point reads what the mute did
// to the sound.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { DOUBLE_CLICK_WINDOW, HUD_SOUND_ITEM } from "../constants";
import {
  captureStill,
  card,
  clickAt,
  createHarness,
  dropRectIn,
  framesFor,
  grabPoint,
  menuPoint,
  movePointerTo,
  openTable,
  poseColumn,
  poseStock,
  pressAt,
  rectCenter,
  releaseAt,
  siteOf,
  watchCues,
  type Harness,
} from "../harness";
import { audibleSince } from "./cues";

/**
 * Frames driven between the `SOUND` click and the events that follow it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so the press below
 * falls outside the window the `SOUND` click is measured against and the two
 * cannot pair into a double click. Nothing happens across these frames, so they
 * are part of the silence this point reads.
 */
const GAP = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The stock this scenario stands on: seven face-down cards.
 *
 * More than the three a Draw Three turn moves (specs/stock.md), so the turn below
 * is an ordinary turn of a stock that still holds cards under either deal mode.
 */
const STOCK = [
  card("clubs", 2),
  card("clubs", 3),
  card("clubs", 4),
  card("clubs", 5),
  card("clubs", 6),
  card("clubs", 7),
  card("clubs", 8),
];

/** The run that is carried, and the column that takes it (specs/tableau.md). */
const RUN = card("hearts", 5);
const TARGET = card("spades", 6);
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds nothing at all once the SOUND control has muted the game, through a turn, a lift and a drop", async () => {
  openTable(h);
  poseStock(h, STOCK);
  const [run] = poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  const cues = watchCues(h);

  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game opens unmuted, so the SOUND click below turns muting on " +
      "rather than off (specs/audio.md)",
  );

  clickAt(h, menuPoint(h, HUD_SOUND_ITEM).x, menuPoint(h, HUD_SOUND_ITEM).y);
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit the snapshot reports after one click inside the region the build " +
      "reports for its SOUND item (specs/audio.md, specs/screens.md)",
  );

  // Everything the bus announces from here on is read, whatever its name.
  const mark = cues.length;
  await h.advance(GAP);

  // One turn of the stock.
  h.debug.turnStock();
  await h.advance(1);
  assertGreaterThan(
    h.snapshot().waste.length,
    0,
    "cards on the waste after the turn, so the muted game still turns its " +
      "stock (specs/stock.md, specs/audio.md: the game stays fully playable)",
  );

  // One press that lifts a run.
  const from = grabPoint(h.snapshot(), FROM_COLUMN, FROM_ROW);
  const to = rectCenter(dropRectIn(h.snapshot(), "tableau", TO_COLUMN));
  pressAt(h, from.x, from.y);
  await h.advance(1);
  assertNotNull(
    h.snapshot().drag,
    "the run in hand after the press on the red five, so the muted game still " +
      "lifts a run (specs/controls.md, specs/audio.md)",
  );

  // One release a column accepts.
  movePointerTo(h, to.x, to.y);
  releaseAt(h, to.x, to.y);
  await h.advance(1);
  captureStill(h, "muted");
  const landed = siteOf(h.snapshot(), run);
  assertDeepEqual(
    landed === undefined ? null : { pile: landed.pile, index: landed.index },
    { pile: "tableau", index: TO_COLUMN },
    "the pile holding the red five after it was released over the black six, " +
      "so the muted game still completes a move (specs/tableau.md, " +
      "specs/audio.md)",
  );

  assertDeepEqual(
    audibleSince(cues, mark),
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

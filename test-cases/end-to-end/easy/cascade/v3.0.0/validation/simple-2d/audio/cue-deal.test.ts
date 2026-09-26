// audio/cue-deal — dealing a fresh game plays the deal cue.
//
// specs/audio.md fixes `CUES.deal` (`"deal"`) as the cue played when "a fresh game
// is dealt", and governs all ten with one sentence: "Each is played on the frame
// its event happens and at most once on that frame."
//
// So the measurement is: hold an empty table in live play, run a quiet lead of
// frames during which nothing at all happens, then click the HUD's `NEW GAME`
// control and read what sounded on the one frame that carried the deal against what
// sounded on every frame before it. The frames before are the half a build cannot
// fake: a build that blips `deal` on a timer sounds on the deal's frame too, and is
// told apart from a conforming one only by the silence that should have preceded it.
//
// THE GAME IS DEALT, NOT POSED. The debug surface's `deal()` is a pose, and a pose
// runs between frames with no route to the engine's audio bus (`harness.ts`), so it
// would never raise this cue whatever the build does. The deal read here is the one
// the HUD's `NEW GAME` control performs (specs/screens.md), inside a frame's own
// update, which is the path a player takes.
//
// THE TABLE IS EMPTY AND QUIET. `openTable` leaves all thirteen piles empty on the
// `playing` screen, so nothing on the board can raise a cue of any name during the
// lead, and the only event in the whole scenario is the deal.
//
// WHAT THIS DOES NOT DECIDE. That the `NEW GAME` control is drawn, labelled, and
// placed in its rectangle, and that the deal it performs lays out the twenty-eight
// tableau cards correctly, belong to the `screens` and `deal` groups. This point
// reads the cue alone, and asks of the deal only that it happened.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW, HUD_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  menuPoint,
  openTable,
  tapPointer,
  watchCues,
  type Harness,
} from "../harness";
import { playedAfter, playedBefore, playedOn } from "./cues";

/**
 * Frames of silence driven on the empty table, on each side of the click.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the longest
 * span this case fixes anywhere — the launch interval, the only other duration in
 * the case, is `0.18` s (specs/victory.md). So a build that sounds a cue on any
 * period the case names has to cross a window longer than its own period without
 * sounding anything.
 *
 * The SAME window is driven again AFTER the event, and the cue read across it too.
 * A cue belongs to the ONE frame its event happened on (specs/audio.md), so a check
 * that read only the frames before and the event's own frame would pass a build that
 * echoed the cue on the frame after it, or that started it repeating. Reading quiet
 * on both sides closes that.
 */
const QUIET_WINDOW = framesFor(DOUBLE_CLICK_WINDOW);

/** A point inside the HUD's `NEW GAME` rectangle (specs/controls.md). */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.deal on the frame a fresh game is dealt, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  await h.advance(QUIET_WINDOW);

  // The middle of the region the build reports for the HUD's NEW GAME item.
  const NEW_GAME = menuPoint(h, HUD_NEW_GAME_ITEM);
  await tapPointer(h, NEW_GAME.x, NEW_GAME.y);
  const at = h.engine.frame().count;
  captureStill(h, "deal");

  assertGreaterThan(
    h.snapshot().tableau.flat().length,
    0,
    "cards on the tableau after the NEW GAME click, which is the deal whose " +
      "cue this point reads (specs/screens.md, specs/deal.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.deal),
    0,
    `times CUES.deal played over the ${String(QUIET_WINDOW)} frames before the ` +
      "click, on an empty table where nothing happened at all " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.deal),
    1,
    "times CUES.deal played on the frame the fresh game was dealt, which is " +
      "its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.deal),
    0,
    `times CUES.deal played over the ${String(QUIET_WINDOW)} frames after the ` +
      "deal, on a dealt table nothing is touching (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );
});

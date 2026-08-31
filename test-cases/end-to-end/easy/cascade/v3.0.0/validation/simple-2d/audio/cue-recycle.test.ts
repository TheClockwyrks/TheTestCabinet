// audio/cue-recycle — recycling the waste plays the recycle cue.
//
// specs/audio.md fixes `CUES.recycle` (`"recycle"`) as the cue played when "a turn
// of an empty stock recycles the waste", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose an EMPTY stock with a card on the waste, run a quiet
// lead during which nothing happens, then click inside the stock's rectangle and
// read what sounded on the one frame that carried the recycle against what sounded
// on the frames before it.
//
// THIS IS THE OTHER HALF OF `audio/cue-turn`, AND ITS OWN EDGE CASE. specs/stock.md
// makes a turn of an empty stock a recycle rather than a turn, so the same gesture
// raises a different event and a different cue depending on what the stock holds.
// The two are separate points because a build that sounds `turn` for both, or
// `recycle` for both, is broken in one direction only and must grade that way.
//
// THE STOCK IS RECYCLED, NOT POSED. The surface's `turnStock()` is a pose, and a
// pose runs between frames with no route to the engine's audio bus (`harness.ts`),
// so it would never raise this cue. The recycle read here is the one a click inside
// the stock's drop rectangle performs (specs/controls.md), inside a frame's update.
//
// ONE CARD ON THE WASTE IS THE WHOLE WORLD. specs/stock.md leaves "a turn with the
// stock and the waste both empty" doing nothing at all, so the waste has to hold a
// card for the recycle to be an event; one card in a set of one is exactly what a
// turn of a stock holding a single card leaves behind, under either deal mode, and
// it is the smallest world in which this cue can sound.
//
// WHAT THIS DOES NOT DECIDE. That a recycle returns the cards face-down and in
// reverse order, and empties the set memory with them, is the `stock` group's
// requirement. This point reads the cue alone, and asks of the recycle only that
// the cards went back to the stock.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  DOUBLE_CLICK_WINDOW,
  STOCK_X,
  TOP_ROW_Y,
} from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  cardCenter,
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseWaste,
  tapPointer,
  watchCues,
  type Harness,
} from "../harness";
import { playedAfter, playedBefore, playedOn } from "./cues";

/**
 * Frames of silence driven on the posed table, on each side of the click.
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

/** A point inside the stock's drop rectangle (specs/table.md, specs/controls.md). */
const STOCK_POINT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.recycle on the frame a turn of an empty stock recycles the waste, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  poseWaste(h, ["7H"], [1]);
  assertEqual(
    h.snapshot().stock.length,
    0,
    "posing: the stock is empty, which is what makes the click below a " +
      "recycle rather than a turn (specs/stock.md)",
  );
  await h.advance(QUIET_WINDOW);

  await tapPointer(h, STOCK_POINT.x, STOCK_POINT.y);
  const at = h.engine.frame().count;
  captureStill(h, "recycle");

  assertGreaterThan(
    h.snapshot().stock.length,
    0,
    "cards on the stock after the click inside its rectangle, which is the " +
      "recycle whose cue this point reads (specs/stock.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.recycle),
    0,
    `times CUES.recycle played over the ${String(QUIET_WINDOW)} frames before ` +
      "the click, on a table where nothing happened at all (specs/audio.md: a " +
      "cue is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.recycle),
    1,
    "times CUES.recycle played on the frame the empty stock recycled the " +
      "waste, which is its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.recycle),
    0,
    `times CUES.recycle played over the ${String(QUIET_WINDOW)} frames after ` +
      "the recycle, on a table nothing is touching (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );
});

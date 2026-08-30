// audio/cue-turn — turning the stock plays the turn cue.
//
// specs/audio.md fixes `CUES.turn` (`"turn"`) as the cue played when "a turn moves
// cards from the stock onto the waste", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose a stock that holds cards on an otherwise empty table,
// run a quiet lead during which nothing happens, then click inside the stock's
// rectangle and read what sounded on the one frame that carried the turn against
// what sounded on the frames before it. The frames before are the half a build
// cannot fake: a build that blips `turn` on a timer sounds on the turn's frame too.
//
// THE STOCK IS TURNED, NOT POSED. The surface's `turnStock()` is a pose, and a pose
// runs between frames with no route to the engine's audio bus (`harness.ts`), so it
// would never raise this cue whatever the build does. The turn read here is the one
// a click inside the stock's drop rectangle performs (specs/controls.md), inside a
// frame's own update, which is the path a player takes.
//
// THE STOCK HOLDS MORE THAN ONE TURN'S WORTH. specs/stock.md recycles instead of
// turning only when the stock is EMPTY, so a stock posed with more cards than
// `TURN_COUNT` moves is turned rather than recycled under either deal mode, and
// `audio/cue-recycle` decides the other event on its own. Nothing else is on the
// table, so no other event can raise a cue of any name during the lead.
//
// WHAT THIS DOES NOT DECIDE. How many cards a turn moves, and in what order, are
// the `stock` group's and the variant's requirements. This point reads the cue
// alone, and asks of the turn only that cards reached the waste.

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
  poseStock,
  tapPointer,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn } from "./cues";

/**
 * Frames of silence driven on the posed table before the stock is clicked.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the longest
 * span this case fixes anywhere — the launch interval, the only other duration in
 * the case, is `0.18` s (specs/victory.md). So a build that sounds a cue on any
 * period the case names has to cross a window longer than its own period without
 * sounding anything.
 */
const QUIET_LEAD = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The stock this scenario stands on: seven face-down cards.
 *
 * More than the three a Draw Three turn moves (specs/stock.md), so the click below
 * is an ordinary turn of a stock that still holds cards under either deal mode, and
 * never the recycle a turn of an EMPTY stock performs.
 */
const STOCK = ["#2C", "#3C", "#4C", "#5C", "#6C", "#7C", "#8C"];

/** A point inside the stock's drop rectangle (specs/table.md, specs/controls.md). */
const STOCK_POINT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.turn on the frame a turn moves cards onto the waste, and not before", async () => {
  const cues = watchCues(h);
  openTable(h);
  poseStock(h, STOCK);
  assertEqual(
    h.snapshot().waste.length,
    0,
    "posing: the waste holds nothing before the turn, so every card on it " +
      "afterwards is one the turn moved (specs/instrumentation.md)",
  );
  await h.advance(QUIET_LEAD);

  await tapPointer(h, STOCK_POINT.x, STOCK_POINT.y);
  const at = h.engine.frame().count;
  captureStill(h, "turn");

  assertGreaterThan(
    h.snapshot().waste.length,
    0,
    "cards on the waste after the click inside the stock's rectangle, which " +
      "is the turn whose cue this point reads (specs/stock.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.turn),
    0,
    `times CUES.turn played over the ${String(QUIET_LEAD)} frames before the ` +
      "click, on a table where nothing happened at all (specs/audio.md: a cue " +
      "is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.turn),
    1,
    "times CUES.turn played on the frame the turn moved cards onto the waste, " +
      "which is its own frame and at most once on it (specs/audio.md)",
  );
});

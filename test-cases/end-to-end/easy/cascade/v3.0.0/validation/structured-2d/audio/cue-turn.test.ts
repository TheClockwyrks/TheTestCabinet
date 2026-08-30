// audio/cue-turn — turning the stock plays the turn cue.
//
// specs/audio.md fixes `CUES.turn` (`"turn"`) as the cue played when "a turn moves
// cards from the stock onto the waste", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose a stock that holds cards on an otherwise empty
// table, run a quiet lead during which nothing happens, turn the stock once, and
// read what the bus announced across that turn against what it announced over the
// quiet before and the quiet after. The quiet is the half a build cannot fake — a
// build that blips `turn` on a timer sounds during the lead, and one that raises
// a flag it never clears sounds through the trail.
//
// THE STOCK HOLDS MORE THAN ONE TURN'S WORTH. specs/stock.md recycles instead of
// turning only when the stock is EMPTY, so a stock posed with more cards than a
// Draw Three turn moves is turned rather than recycled under either deal mode,
// and `audio/cue-recycle` decides the other event on its own. Nothing else is on
// the table, so no other event can raise a cue of any name during the lead.
//
// WHY THE WINDOW COVERS ONE FRAME AS WELL AS THE CALL. `cues.ts` explains it: an
// operation raises its cue at the call under this engine, and a build that
// carries what an operation raised into the next tick has played it on the frame
// after. Nothing in specs/ separates the two, so the window admits both and reads
// the COUNT across it.
//
// WHAT THIS DOES NOT DECIDE. How many cards a turn moves, in what order, and what
// the waste then shows are the `stock` group's and the variant's requirements.
// This point reads the cue alone, and asks of the turn only that cards reached
// the waste.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  framesFor,
  openTable,
  poseStock,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the turn, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The stock this scenario stands on: seven face-down cards.
 *
 * More than the three a Draw Three turn moves (specs/stock.md), so the turn below
 * is an ordinary turn of a stock that still holds cards under either deal mode,
 * and never the recycle a turn of an EMPTY stock performs.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.turn once when a turn moves cards onto the waste, and not on the quiet frames either side", async () => {
  openTable(h);
  poseStock(h, STOCK);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertEqual(
    h.snapshot().waste.length,
    0,
    "posing: the waste holds nothing before the turn, so every card on it " +
      "afterwards is one the turn moved (specs/instrumentation.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.turn),
    0,
    `times CUES.turn played over the ${String(QUIET)} frames before the turn, ` +
      "on a table where nothing happened at all (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );

  // The window: the call the turn happens on, and the one frame that follows it.
  const mark = cues.length;
  h.debug.turnStock();
  await h.advance(1);
  captureStill(h, "turn");
  const sounded = playedSince(cues, mark, CUES.turn);

  assertGreaterThan(
    h.snapshot().waste.length,
    0,
    "cards on the waste after the turn, which is the turn whose cue this " +
      "point reads (specs/stock.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.turn played across the turn, which plays it once and at most " +
      "once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.turn sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.turn),
    0,
    `times CUES.turn played over the ${String(QUIET)} frames after the turn, ` +
      "on a table nothing is touching (specs/audio.md: a cue is played on the " +
      "frame its event happens)",
  );
});

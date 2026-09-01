// audio/cue-recycle — recycling the waste back into the stock plays the recycle
// cue.
//
// specs/audio.md fixes `CUES.recycle` (`"recycle"`) as the cue played when "a turn
// of an empty stock recycles the waste", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose an EMPTY stock with cards on the waste, run a quiet
// lead during which nothing happens, turn the stock once — which recycles, since
// the stock is empty (specs/stock.md) — and read what the bus announced across
// that recycle against what it announced over the quiet before and the quiet
// after.
//
// THE RECYCLE IS PROVED BY THE TABLE, NOT BY THE CUE. specs/stock.md: "every card
// on the waste returns to the stock face-down... The waste is left empty and its
// set memory is emptied with it." So the point asserts the cards really crossed
// back before it reads what sounded, and a build that sounded the cue and moved
// nothing fails here rather than passing on the noise.
//
// THIS IS THE OTHER EVENT A CLICK ON THE STOCK CAN RAISE. `audio/cue-turn` poses a
// stock that holds cards, so its click turns; this one poses an empty stock, so
// its click recycles. Each decides its own cue on its own event, and a build that
// gets one right and the other wrong is docked once.
//
// THE WASTE'S SET MEMORY IS IMMATERIAL HERE. A recycle empties the memory whatever
// it held (specs/stock.md), so the sets below are posed only because a waste's
// cards and the sets it remembers are two different things and `poseWaste` never
// omits one: three one-card sets are the three turns a Draw One stock makes.
//
// WHY THE WINDOW COVERS ONE FRAME AS WELL AS THE CALL. `cues.ts` explains it: an
// operation raises its cue at the call under this engine, and a build that
// carries what an operation raised into the next tick has played it on the frame
// after. Nothing in specs/ separates the two, so the window admits both and reads
// the COUNT across it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  framesFor,
  openTable,
  poseWaste,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the recycle, and again
 * after it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/** The cards on the waste, bottom-most first, and the sets they belong to. */
const WASTE = [card("hearts", 4), card("hearts", 5), card("hearts", 6)];
const WASTE_SETS = [1, 1, 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.recycle once when a turn of an empty stock recycles the waste, and not on the quiet frames either side", async () => {
  openTable(h);
  poseWaste(h, WASTE, WASTE_SETS);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertEqual(
    h.snapshot().stock.length,
    0,
    "posing: the stock holds nothing, so the turn below is the recycle a turn " +
      "of an empty stock performs (specs/stock.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.recycle),
    0,
    `times CUES.recycle played over the ${String(QUIET)} frames before the ` +
      "recycle, on a table where nothing happened at all (specs/audio.md: a " +
      "cue is played on the frame its event happens)",
  );

  // The window: the call the recycle happens on, and the frame that follows it.
  const mark = cues.length;
  h.debug.turnStock();
  await h.advance(1);
  captureStill(h, "recycle");
  const sounded = playedSince(cues, mark, CUES.recycle);

  assertEqual(
    h.snapshot().stock.length,
    WASTE.length,
    "cards back on the stock after the turn of an empty stock, which is the " +
      "recycle whose cue this point reads (specs/stock.md)",
  );
  assertEqual(
    h.snapshot().waste.length,
    0,
    "cards left on the waste after the recycle, which returns every one of " +
      "them to the stock (specs/stock.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.recycle played across the recycle, which plays it once and at " +
      "most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.recycle sounded at on an unmuted game, which is what makes " +
      "it a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.recycle),
    0,
    `times CUES.recycle played over the ${String(QUIET)} frames after the ` +
      "recycle, on a table nothing is touching (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );
});

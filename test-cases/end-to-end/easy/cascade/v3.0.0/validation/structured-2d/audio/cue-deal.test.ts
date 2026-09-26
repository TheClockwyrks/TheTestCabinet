// audio/cue-deal — dealing a fresh game plays the deal cue.
//
// specs/audio.md fixes `CUES.deal` (`"deal"`) as the cue played when "a fresh game
// is dealt", and governs all ten with one sentence: "Each is played on the frame
// its event happens and at most once on that frame."
//
// So the measurement is: open an EMPTY table in play, run a quiet lead during
// which nothing at all happens, deal one fresh game, and read what the bus
// announced across that deal against what it announced over the quiet before and
// the quiet after. The quiet is the half a build cannot fake — a build that blips
// `deal` on a timer sounds during the lead, and one that raises a flag it never
// clears sounds through the trail — and the deal itself is the half that decides
// the cue was played on its own event.
//
// THE DEAL IS THE GAME'S OWN. `deal()` is one of the four operations that route
// through exactly the code a player's gesture routes through
// (specs/instrumentation.md), so what sounds here is what the build's own deal
// sounded, and the point does not first have to reach the title screen's
// `NEW GAME` control to ask for one. It is checked to have really happened: a
// full deck stands on the table afterwards (specs/deal.md), so a build that
// sounded the cue and dealt nothing fails.
//
// WHY THE WINDOW COVERS ONE FRAME AS WELL AS THE CALL. `cues.ts` explains it: an
// operation raises its cue at the call under this engine, and a build that
// carries what an operation raised into the next tick has played it on the frame
// after. Nothing in specs/ separates the two, so the window admits both and reads
// the COUNT across it.
//
// WHAT THIS DOES NOT DECIDE. What the deal puts where, and how it is shuffled,
// are the `deal` group's requirements. This point reads the cue alone, and asks
// of the deal only that a full deck reached the table.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES, DECK_SIZE, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  createHarness,
  everyCard,
  framesFor,
  openTable,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the deal, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.deal once when a fresh game is dealt, and not on the quiet frames either side", async () => {
  openTable(h);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.deal),
    0,
    `times CUES.deal played over the ${String(QUIET)} frames before the deal, ` +
      "on an empty table where nothing happened at all (specs/audio.md: a cue " +
      "is played on the frame its event happens)",
  );

  // The window: the call the deal happens on, and the one frame that follows it.
  const mark = cues.length;
  h.debug.deal();
  await h.advance(1);
  captureStill(h, "deal");
  const sounded = playedSince(cues, mark, CUES.deal);

  assertEqual(
    everyCard(h.snapshot()).length,
    DECK_SIZE,
    "cards on the table after the deal, which is the deal whose cue this " +
      "point reads (specs/deal.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.deal played across the deal, which plays it once and at most " +
      "once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.deal sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.deal),
    0,
    `times CUES.deal played over the ${String(QUIET)} frames after the deal, ` +
      "on a dealt table nothing is touching (specs/audio.md: a cue is played " +
      "on the frame its event happens)",
  );
});

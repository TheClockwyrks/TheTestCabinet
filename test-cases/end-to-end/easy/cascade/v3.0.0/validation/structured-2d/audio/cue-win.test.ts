// audio/cue-win — the move that completes the board plays the win cue.
//
// specs/audio.md fixes `CUES.win` (`"win"`) as the cue played when "the game is
// won", and governs all ten with one sentence: "Each is played on the frame its
// event happens and at most once on that frame." specs/victory.md fixes the event
// itself: "The game is won the instant all `DECK_SIZE` (`52`) cards are on the
// foundations... and the game moves to the `won` screen on that move."
//
// So the measurement is: pose a board one legal move from winning — every
// foundation complete but one, held at its Queen, with that suit's King on a
// column and nothing else on the table — run a quiet lead, make that one move,
// and read what the bus announced across it against what it announced before and
// after.
//
// THE WIN IS THE GAME'S OWN. Nothing here poses the `won` screen: the move is
// made through `move()`, which routes through exactly the code a player's gesture
// routes through, and "an accepted move applies through the same path a released
// drop uses, so... a completed board wins" (specs/instrumentation.md). The screen
// and the count of cards home are both read back, so a build that sounded the cue
// without winning fails here rather than passing on the noise.
//
// THE WINDOW HOLDS SEVERAL EVENTS, AND ONLY ONE OF THEM IS THIS POINT'S. The last
// move raises `drop` and `home` as well, and the cascade that begins with the win
// raises `launch` (specs/audio.md: "a frame that raises more than one of them
// plays each of those once"). So this point counts `win` alone; `audio/cue-drop`,
// `audio/cue-home` and `audio/cue-launch` each decide their own on a scenario
// that raises theirs by itself.
//
// THE TRAILING QUIET RUNS OVER A LIVE CASCADE. Cards keep launching through it,
// which is what the `won` screen does; what it reads is that the WIN cue does not
// sound a second time, because the game is won once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES, DECK_SIZE, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  cardsHome,
  createHarness,
  framesFor,
  poseNearlyWon,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the move, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/** The seed the board is posed with; nothing this point reads turns on it. */
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.win once on the move that puts the fifty-second card home, and not on the quiet frames either side", async () => {
  const posed = poseNearlyWon(h, { seed: SEED });
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is still in play before the last move, so the move " +
      "below is what wins it (specs/victory.md)",
  );
  assertEqual(
    h.snapshot().winDetect,
    true,
    "posing: the win test is left on, which is the faculty this point " +
      "exercises (specs/instrumentation.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.win),
    0,
    `times CUES.win played over the ${String(QUIET)} frames before the move, ` +
      "on a board that had not been completed (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );

  // The window: the call the last move happens on, and the frame that follows.
  const mark = cues.length;
  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  // Read before the frame runs: the cascade starts taking cards back off the
  // foundations on its first frame (specs/victory.md).
  const home = cardsHome(h.snapshot());
  await h.advance(1);
  captureStill(h, "win");
  const sounded = playedSince(cues, mark, CUES.win);

  assertEqual(
    accepted,
    true,
    "the verdict on moving the last King onto the foundation holding its " +
      "Queen, which that foundation accepts (specs/foundations.md)",
  );
  assertEqual(
    home,
    DECK_SIZE,
    "cards on the foundations the instant the last move landed, which is the " +
      "win whose cue this point reads (specs/victory.md)",
  );
  assertEqual(
    h.snapshot().screen,
    "won",
    "the screen the game moved to on that move (specs/victory.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.win played across the winning move, which plays it once and " +
      "at most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.win sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.win),
    0,
    `times CUES.win played over the ${String(QUIET)} frames after the win, ` +
      "on a game that is won once (specs/audio.md: a cue is played on the " +
      "frame its event happens)",
  );
});

// audio/cue-win — winning the game plays the win cue.
//
// specs/audio.md fixes `CUES.win` (`"win"`) as the cue played when "the game is
// won", and governs all ten with one sentence: "Each is played on the frame its
// event happens and at most once on that frame."
//
// So the measurement is: pose a table one card short of a win, run a quiet lead
// during which fifty-one cards sit home and nothing happens, then press the last
// card on one frame and release it over its foundation on the next. specs/victory.md
// wins the game "the instant all fifty-two cards are on the foundations", by the
// move that put the last one there, so the release's frame is the win's frame, and
// this point reads it against every frame before it.
//
// THE GAME IS WON, NOT POSED. `setScreen` moves to the won screen without winning,
// so it would never raise this cue, and the pointer operations are poses with no
// route to the engine's audio bus (`harness.ts`). The win read here is the build's
// own rules reaching it inside a frame's own update, on the release of a real drop.
//
// FIFTY-ONE CARDS HOME IS QUIET. The lead runs on a board that is complete but for
// one card, so a build that wins early would be sounding this cue during the lead
// and is caught by the "and not before" reading; `winning/no-win-at-fifty-one`
// decides the early win itself. `winDetect` is left on, because reaching the win is
// exactly the faculty this requirement exercises.
//
// `launching` AND `trailPainting` ARE HELD OFF. The victory cascade begins with the
// win (specs/victory.md), and neither the cards it launches nor the layer it paints
// is any part of this requirement; specs/instrumentation.md gates both so a check
// exercises only the faculties it is about. The same frame legitimately raises
// `drop` and `home` as well — a frame that raises more than one cue plays each of
// those once (specs/audio.md) — and this point counts `win` alone.
//
// THE GESTURE IS SPLIT ACROSS TWO FRAMES, for the reason `audio/cue-drop` states: a
// press sharing the release's frame would hide a build that sounded `win` on the
// press rather than on the win.
//
// WHAT THIS DOES NOT DECIDE. That the win is reached at fifty-two cards and not at
// fifty-one, and what the won screen then shows, are the `winning` and `screens`
// groups' requirements. This point reads the cue alone, and asks of the move only
// that the game arrived on the won screen.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseNearlyWon,
  pressPoint,
  releasePoint,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn, pressFrame, releaseFrame } from "./cues";

/**
 * Frames of silence driven on the nearly-won table before the press.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the longest
 * span this case fixes anywhere — the launch interval, the only other duration in
 * the case, is `0.18` s (specs/victory.md). So a build that sounds a cue on any
 * period the case names has to cross a window longer than its own period without
 * sounding anything. It is also longer than the double-click window itself, so the
 * press below is measured against no press before it.
 */
const QUIET_LEAD = framesFor(DOUBLE_CLICK_WINDOW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.win on the frame the last card home wins the game, and not before", async () => {
  const cues = watchCues(h);
  openTable(h);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);
  const pending = poseNearlyWon(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is still in live play with one card left to send home " +
      "(specs/victory.md)",
  );
  await h.advance(QUIET_LEAD);

  await pressFrame(
    h,
    pressPoint(
      h.snapshot(),
      pending.from.pile,
      pending.from.index,
      pending.from.row,
    ),
  );
  const at = await releaseFrame(
    h,
    releasePoint(h.snapshot(), "foundation", pending.foundation),
  );
  captureStill(h, "win");

  assertEqual(
    h.snapshot().screen,
    "won",
    "the screen after the last card was released onto its foundation, which " +
      "is the win whose cue this point reads (specs/victory.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.win),
    0,
    `times CUES.win played over the ${String(QUIET_LEAD)} quiet frames and ` +
      "the press frame before the release, with fifty-one cards home and the " +
      "game unwon (specs/audio.md: a cue is played on the frame its event " +
      "happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.win),
    1,
    "times CUES.win played on the frame the game was won, which is its own " +
      "frame and at most once on it (specs/audio.md)",
  );
});

// audio/cue-lift — a press that lifts a run plays the lift cue.
//
// specs/audio.md fixes `CUES.lift` (`"lift"`) as the cue played when "a press
// lifts a run into the hand", and governs all ten with one sentence: "Each is
// played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose one face-up card on an otherwise empty table, run a
// quiet lead during which nothing happens, press on that card, and read what the
// bus announced across the press against what it announced over the quiet before
// and the quiet after.
//
// THE RUN ENTERS THE HAND ON THE PRESS ITSELF, before the pointer has moved at
// all (specs/controls.md), so the press alone is the whole event this point is
// about and the gesture is deliberately left unfinished: the run is still in hand
// when the trailing quiet is read. `audio/cue-drop` and `audio/cue-reject` decide
// what the release sounds; a build that sounded `lift` on the release rather than
// on the press fails here, on a window that closes one frame after the press.
//
// THE PRESS LANDS ON THE COLUMN'S LOWEST CARD, which is a card the press picks up
// (specs/controls.md), and the lift is checked against the snapshot's `drag`
// before the cue is read — so a build that sounded the cue and lifted nothing
// fails here rather than passing on the noise.
//
// WHY THE WINDOW COVERS ONE FRAME AS WELL AS THE CALL. `cues.ts` explains it: a
// pointer operation resolves at the call under this engine, and a build that
// carries what it raised into the next tick has played the cue on the frame
// after. Nothing in specs/ separates the two, so the window admits both and reads
// the COUNT across it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  framesFor,
  grabPoint,
  openTable,
  poseColumn,
  pressAt,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the press, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/** The one card on the table: a face-up card on a column, and the column it sits on. */
const CARD = card("hearts", 5);
const COLUMN = 0;
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.lift once when a press lifts a run into the hand, and not on the quiet frames either side", async () => {
  openTable(h);
  const [id] = poseColumn(h, COLUMN, [CARD]);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.lift),
    0,
    `times CUES.lift played over the ${String(QUIET)} frames before the ` +
      "press, on a table where nothing happened at all (specs/audio.md: a cue " +
      "is played on the frame its event happens)",
  );

  // The window: the press the run is lifted on, and the frame that follows it.
  const mark = cues.length;
  const at = grabPoint(h.snapshot(), COLUMN, ROW);
  pressAt(h, at.x, at.y);
  await h.advance(1);
  captureStill(h, "lift");
  const sounded = playedSince(cues, mark, CUES.lift);

  const drag = h.snapshot().drag;
  assertNotNull(
    drag,
    "the run in hand after the press on the column's lowest card, which is " +
      "the lift whose cue this point reads (specs/controls.md)",
  );
  assertEqual(
    drag?.cards[0].id,
    id,
    "the id of the card the press put in hand, which is the card it landed " +
      "on (specs/controls.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.lift played across the press, which plays it once and at most " +
      "once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.lift sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.lift),
    0,
    `times CUES.lift played over the ${String(QUIET)} frames after the press, ` +
      "with the run still held and the pointer still (specs/audio.md: a cue " +
      "is played on the frame its event happens)",
  );
});

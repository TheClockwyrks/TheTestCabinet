// handling/slow-second-press-does-not — a second press past the window is not a
// double click.
//
// THE RULE. specs/controls.md: a press is a double click only when it "arrives
// within `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous
// press". A press that does not is an ordinary press, and the release that follows
// it within `DRAG_THRESHOLD` is an ordinary click, which "returns any held run to
// the pile it was lifted from, in the order it was lifted, with every face
// unchanged".
//
// THE SEPARATION. `0.4` seconds of game time, which is `0.1` s past the window —
// six whole frames at the suite's 60 Hz, so no rounding of the frame count can
// bring it back inside. The two presses land on the same point, so the slop
// condition holds and the WINDOW is the only condition that fails: a build with no
// window at all, or one measuring it in frames rather than seconds, or one whose
// window is longer than the specification's, sends the card home here and fails.
//
// THE SAME BOARD AS `handling/double-click-auto-moves`, which drives the same two
// presses `0.1` s apart and requires the card TO go home. The pair is what makes a
// grade say whether a build has a window or merely has a double click.
//
// WHAT IS READ. The card is still on its column, face-up as it was posed, and the
// foundation still holds its Ace alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { DOUBLE_CLICK_WINDOW } from "../constants";
import {
  ACE,
  captureStill,
  card,
  clickAt,
  createHarness,
  framesFor,
  grabPoint,
  openTable,
  poseColumn,
  poseFoundation,
  secondsFor,
  TWO,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The foundation the Ace of spades starts, and the suit in play. */
const FOUNDATION = 0;
const SUIT = "spades";

/** The card on the column: the one a double click would have sent home. */
const COLUMN = 0;
const CARDS = [card(SUIT, TWO)];

/**
 * How many frames separate the two presses: the whole of `DOUBLE_CLICK_WINDOW`
 * (`0.30`, specs/controls.md) and a third of it again — twenty-four frames,
 * `0.4` s of game time at the suite's clock. The margin is six whole frames, so
 * the second press is outside the window however a build rounds a frame count.
 * The window is read off this project's own `constants.ts`, which transcribes it
 * from specs/controls.md.
 */
const WINDOW_FRAMES = framesFor(DOUBLE_CLICK_WINDOW);
const GAP_FRAMES = WINDOW_FRAMES + Math.round(WINDOW_FRAMES / 3);

/** That gap as the seconds of game time a failure names. */
const SEPARATION = secondsFor(GAP_FRAMES);

/** The two piles as they must read after the gesture: exactly as posed. */
const UNCHANGED_FOUNDATION = ["AS"];
const UNCHANGED_COLUMN = ["2S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card where it was when the second press arrives past the window", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  poseColumn(h, COLUMN, CARDS);

  const at = grabPoint(h.snapshot(), COLUMN, 0);
  clickAt(h, at.x, at.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, at.x, at.y);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    UNCHANGED_COLUMN,
    `column ${String(COLUMN)} after two presses ${String(SEPARATION)} s ` +
      "apart, which is past DOUBLE_CLICK_WINDOW (0.30) and so is not a double " +
      "click: the second press is an ordinary press and its click returns the " +
      "run it lifted (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    UNCHANGED_FOUNDATION,
    `foundation ${String(FOUNDATION)} after the gesture: no card was sent ` +
      "home (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the second click, which returns whatever it lifted " +
      "(specs/controls.md)",
  );
});

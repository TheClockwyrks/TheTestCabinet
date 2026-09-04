// audio/cue-home — a card a foundation accepts plays the home cue.
//
// specs/audio.md fixes `CUES.home` (`"home"`) as the cue played when "a card is
// accepted onto a foundation, by any move", and governs all ten with one
// sentence: "Each is played on the frame its event happens and at most once on
// that frame."
//
// So the measurement is: pose a foundation holding the Ace of clubs and the two
// of clubs on a column, run a quiet lead, move the two onto that foundation — the
// card of rank `r + 1` and suit `s`, which is what a foundation holding rank `r`
// of suit `s` accepts (specs/foundations.md) — and read what the bus announced
// across the move against what it announced before and after it.
//
// THE MOVE IS THE GAME'S OWN. `move()` routes through exactly the code a player's
// gesture routes through (specs/instrumentation.md) and reports the verdict the
// game's own rules reached, so this point reads the cue of a card that really
// went home. Reaching the same event through a press and a release would drag
// `audio/cue-lift`'s and `audio/cue-drop`'s requirements into this point's
// verdict for nothing.
//
// THE WINDOW HOLDS TWO EVENTS, AND ONLY ONE OF THEM IS THIS POINT'S. An accepted
// move raises `drop` as well, since the pile it resolved to accepted it, and
// specs/audio.md says as much: "A drop accepted by a foundation raises both
// `drop` and `home`." So this point counts `home` and reads nothing about the
// other names.
//
// THE BOARD IS NOWHERE NEAR COMPLETE. Two cards are on the foundations when the
// move lands, so the win test does not fire and neither the `won` screen nor the
// cascade is anywhere in this scenario — `audio/cue-win` and `audio/cue-launch`
// decide those.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  ACE,
  TWO,
  captureStill,
  card,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  siteOf,
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

/** The foundation, holding its Ace, and the card that goes home onto it. */
const SUIT = "clubs";
const FOUNDATION = 0;
const CARD = card(SUIT, TWO);
const FROM_COLUMN = 0;
const FROM_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.home once when a foundation accepts a card, and not on the quiet frames either side", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  const [id] = poseColumn(h, FROM_COLUMN, [CARD]);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.home),
    0,
    `times CUES.home played over the ${String(QUIET)} frames before the move, ` +
      "on a table where nothing happened at all (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );

  // The window: the call the move happens on, and the frame that follows it.
  const mark = cues.length;
  const accepted = h.debug.move(
    "tableau",
    FROM_COLUMN,
    FROM_ROW,
    "foundation",
    FOUNDATION,
  );
  await h.advance(1);
  captureStill(h, "home");
  const sounded = playedSince(cues, mark, CUES.home);

  assertEqual(
    accepted,
    true,
    "the verdict on moving the two of clubs onto the foundation holding its " +
      "Ace, which that foundation accepts (specs/foundations.md)",
  );
  const landed = siteOf(h.snapshot(), id);
  assertDeepEqual(
    landed === undefined ? null : { pile: landed.pile, index: landed.index },
    { pile: "foundation", index: FOUNDATION },
    "the pile holding the two of clubs after the move, which is the card " +
      "reaching a foundation whose cue this point reads (specs/foundations.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.home played across the move that took the card home, which " +
      "plays it once and at most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.home sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.home),
    0,
    `times CUES.home played over the ${String(QUIET)} frames after the move, ` +
      "on a table nothing is touching (specs/audio.md: a cue is played on the " +
      "frame its event happens)",
  );
});

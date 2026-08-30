// audio/cue-win — the drop that completes the board sounds one cue more than the
// same drop that completes only a foundation.
//
// `specs/audio.md`'s cue table: `win` is played when "The game is won".
// `specs/victory.md` fixes the event: "The game is won the instant all
// `DECK_SIZE` (`52`) cards are on the foundations ... and the game moves to the
// `won` screen on that move."
//
// WHY THIS POINT COUNTS RATHER THAN LISTENS FOR ONE SOUND. A win never happens on
// its own: it is reached by the move that puts the last card home, and that move
// raises `drop` and `home` on the same frame — `specs/audio.md` says so outright:
// "A drop accepted by a foundation raises both `drop` and `home`." What the same
// file fixes is what a frame carrying several events sounds like: each cue "is
// played on the frame its event happens and at most once on that frame; a frame
// that raises more than one of them plays each of those once." So a frame
// carrying drop, home AND win must emit strictly more sound than a frame
// carrying drop and home alone, whatever a single cue is made of, because those
// two are the SAME cues in both.
//
// SO THE SAME DROP IS DRIVEN TWICE, and the two release frames are compared. In
// both drives the King of clubs is lifted from column `0` and released over
// foundation `3`, which holds the Ace through the Queen of clubs and therefore
// accepts it (`specs/foundations.md`). The boards differ in one thing only:
// whether the other three foundations are already complete, which is what
// decides whether that thirteenth club is the fifty-second card home. Nothing
// else about the gesture, the card, the source or the target changes.
//
// LAUNCHING IS HELD SHUT IN BOTH DRIVES. `specs/victory.md` has the cascade begin
// with the win and its first card launch on the cascade's first frame, which is
// the winning frame itself, so its `launch` cue would land in the same count.
// `setLaunching(false)` gates "the cascade's launch clock and the launching of
// the next card, and nothing else" (`specs/instrumentation.md`), so what is left
// between the two counts is the win alone. `audio/cue-launch` is the point that
// grades the launch.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment. This point reads a COUNT, never a name.
//
// A BUILD THAT BLIPS ON EVERY FRAME IS NOT LET THROUGH BY THE COMPARISON: its
// blip lands on both release frames alike and cancels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { RANK_MAX, SUITS } from "../constants";
import {
  captureStill,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  poseNearlyWon,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { realDrop, soundsOn } from "./cues";

/** Quiet play driven after each drop, so the still shows the settled screen. */
const SETTLE_FRAMES = framesFor(0.2);

/** The suit the last King belongs to, and the foundation it goes home on. */
const SUIT = SUITS[SUITS.length - 1];
const FOUNDATION = SUITS.length - 1;
const KING = "KC";
const FROM = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the drop that wins the game than on the drop that only completes a foundation", async () => {
  await h.armAudio();
  const played = watchCues(h);
  const at = columnCardTopLeft(FROM, 0, [true]);
  const press = cardCenter(at.x, at.y);
  const target = rectCenter(dropRect("foundation", FOUNDATION));

  // ---- The winning drop: fifty-one cards home, and this is the fifty-second. -
  await openTable(h);
  await h.debug.setLaunching(false);
  await poseNearlyWon(h, { suit: SUIT, at: { pile: "tableau", index: FROM } });

  const winning = await realDrop(h, press, target);
  const onTheWinningDrop = soundsOn([...played], winning.dropFrame);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "win");

  // ---- The same drop on a board where only this foundation completes. -------
  await openTable(h);
  await h.debug.setLaunching(false);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MAX - 1);
  await poseColumn(h, FROM, cards(KING));

  const completing = await realDrop(h, press, target);
  const onTheCompletingDrop = soundsOn([...played], completing.dropFrame);
  await h.advance(SETTLE_FRAMES);

  // Both drops were accepted onto the same foundation, and exactly one won.
  assertEqual(winning.lifted, true, "the press to lift the last King");
  assertEqual(
    winning.snapshot.foundations[FOUNDATION].length,
    RANK_MAX,
    "the cards on the foundation the winning King went home on",
  );
  assertEqual(
    winning.snapshot.screen,
    "won",
    "the screen the winning drop reached",
  );
  assertEqual(
    completing.lifted,
    true,
    "the press to lift the King in the control drive",
  );
  assertEqual(
    completing.snapshot.foundations[FOUNDATION].length,
    RANK_MAX,
    "the cards on the foundation the King completed",
  );
  assertEqual(
    completing.snapshot.screen,
    "playing",
    "the screen the drop that completed one foundation left the game on",
  );

  assertGreaterThan(
    onTheWinningDrop,
    onTheCompletingDrop,
    `sounds on frame ${winning.dropFrame}, the drop that won the game, against the ${onTheCompletingDrop} on frame ${completing.dropFrame}, the drop that only completed a foundation`,
  );
});

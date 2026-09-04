// audio/mute-silences — mute silences every cue.
//
// specs/ui.md fixes the requirement: "The game binds the `mute` action to the
// engine's mute bit and toggles it from any screen. While sound is muted every cue
// is silent and the game stays fully playable." specs/controls.md binds that
// action to `KeyM`, and specs/instrumentation.md reports the result as the
// snapshot's `muted`, which is a live read of the runtime's own bit rather than a
// field any pose can set. So the mute is reached here the way a player reaches it.
//
// SILENCE IS A GAIN OF ZERO, NOT A MISSING ANNOUNCEMENT. Muting belongs to the
// engine's audio bus (specs/ui.md), and the bus announces a play whether or not
// anything can be heard, carrying the gain it sounded at: zero while muted,
// positive otherwise. That is what separates a build that went quiet from one that
// stopped reacting, and it is why this check reads GAIN across the muted window
// rather than counting announcements. A build that suppresses its own `play` calls
// while muted is silent too, and passes on the same reading.
//
// THREE EVENTS, ONE FROM EACH CORNER OF THE GAME. The manifest names them: a menu
// move on the title screen, a bolt fired in live play, and a bolt cutting a worm
// segment. Each is driven through the game's own path and each is checked to have
// actually happened, so the silence this point reports is the silence of a working
// game rather than of a broken one. `audio/menu`, `audio/fire` and `audio/cut`
// decide that each of the three sounds its cue when the game is NOT muted; this
// point decides that none of them sounds when it is.
//
// THE MUTED WINDOW COVERS EVERYTHING AFTER THE KEY. Every cue the bus announced
// from the `KeyM` press onward is read, whatever its name, so a build that
// silences the three cues the manifest names and leaves some fourth one audible is
// caught here too.
//
// WHAT THIS DOES NOT DECIDE. That `KeyM` is bound to the mute action at all is
// `controls.mute-m`'s requirement. This point reads what the mute did to the
// sound.

import { afterEach, beforeEach, it } from "vitest";
import {
  BINDINGS,
  BOLT_SPEED,
  FIRE_INTERVAL,
  TILE,
  TITLE_ITEMS,
} from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The keys specs/controls.md binds the actions this check drives to first. */
const MUTE_KEY = BINDINGS.mute[0];
const MENU_DOWN_KEY = BINDINGS.down[0];
const FIRE_KEY = BINDINGS.a[0];

/** The highlight the title is posed on, and the item one move down from it. */
const FIRST_ITEM = 0;
const SECOND_ITEM = 1;

/**
 * Frames the held fire key is given to produce a bolt.
 *
 * specs/cursor.md fires "whenever the cooldown is at `0` and fewer than
 * `MAX_BOLTS` bolts are in flight", and `startPlaying` leaves the cooldown at `0`
 * with no bolt in flight, so a conforming build fires on the first update the
 * action is held. Two whole fire intervals is a hard ceiling many times that.
 */
const FIRE_FRAMES = ticksFor(2 * FIRE_INTERVAL);

/**
 * The row the worm is laid along, the column its head stands in, how many
 * segments it carries, and which of them the bolt is aimed at.
 *
 * Row 10 is in the open middle of the board, clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md). Three segments, so removing
 * one does not clear the level (specs/progression.md) and the run carries on
 * through the reading.
 */
const WORM_R = 10;
const HEAD_C = 20;
const WORM_LENGTH = 3;
const TAIL_C = HEAD_C - (WORM_LENGTH - 1);

/** How far below the struck segment the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's center is inside the segment's tile". Posed four tiles
 * below it, its center starts `3.5` tiles, `112` units, under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget.
 */
const BOLT_FRAMES = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/** Every segment standing on the board, across every worm on it. */
function segmentCount(snapshot: WirewormSnapshot): number {
  return snapshot.worms.reduce(
    (total, worm) => total + worm.segments.length,
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds nothing at all once KeyM has muted the game, through a menu move, a shot and a cut", async () => {
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FIRST_ITEM);
  assertEqual(
    TITLE_ITEMS.length,
    SECOND_ITEM + 1,
    "posing: the title menu holds the two items the move runs between " +
      "(specs/ui.md)",
  );
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game opens with the engine's mute bit off, so the KeyM press " +
      "below turns muting on rather than off (specs/ui.md)",
  );

  await h.tap(MUTE_KEY);
  assertEqual(
    h.snapshot().muted,
    true,
    `the mute bit the snapshot reports after one ${MUTE_KEY} press, which the ` +
      "mute action toggles from any screen (specs/ui.md, specs/controls.md)",
  );

  // Everything the bus announces from here on is read, whatever its name.
  const muted = h.cues.length;

  // One menu highlight move, on the screen the mute was pressed on.
  await h.tap(MENU_DOWN_KEY);
  assertEqual(
    h.snapshot().menuIndex,
    SECOND_ITEM,
    `the highlight the ${MENU_DOWN_KEY} press moved to, which is the event ` +
      "whose cue must have been silent (specs/controls.md)",
  );

  // One bolt fired, from the cursor's own firing path in live play.
  startPlaying(h);
  h.hold(FIRE_KEY);
  let fired;
  try {
    fired = await h.until((s) => s.bolts.length > 0, {
      maxFrames: FIRE_FRAMES,
    });
  } finally {
    h.release(FIRE_KEY);
  }
  assertEqual(
    fired.hit,
    true,
    `a bolt appeared inside the ${String(FIRE_FRAMES)} frames the ${FIRE_KEY} ` +
      "key was held for, so the muted game is still fully playable " +
      "(specs/cursor.md, specs/ui.md)",
  );

  // One worm segment cut. The fired bolt is taken off first, so the only thing
  // that reaches the worm is the bolt this stage puts in flight.
  h.debug.clearBolts();
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBolt(h, TAIL_C, WORM_R + BOLT_DROP_TILES);
  const cut = await h.until((s) => segmentCount(s) < WORM_LENGTH, {
    maxFrames: BOLT_FRAMES,
  });
  captureStill(h, "muted");
  assertEqual(
    cut.hit,
    true,
    `the bolt destroyed a segment inside the ${String(BOLT_FRAMES)} frames of ` +
      "flight the check allows it, so the muted game is still fully playable " +
      "(specs/cursor.md, specs/ui.md)",
  );

  assertDeepEqual(
    h.cues
      .slice(muted)
      .filter((one) => one.gain > 0)
      .map((one) => one.cue),
    [],
    "the cues that sounded at an audible gain after the game was muted, " +
      "across a menu move, a bolt fired and a segment cut (specs/ui.md: " +
      "while sound is muted every cue is silent)",
  );
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit the snapshot reports after the three events, which nothing " +
      "but the mute action changes (specs/instrumentation.md)",
  );
});

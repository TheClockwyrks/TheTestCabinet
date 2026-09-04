// Wireworm — audio/level-clear: clearing a level plays the `level-clear` cue, on
// the frame the level clears.
//
// specs/ui.md's cue table: "`level-clear` | `CUES.levelClear` | A level
// clears.", played "on the frame its event happens and at most once on that
// frame". specs/progression.md fixes the event: "A level clears on the step in
// which the last of its worm segments is removed", and on a clear below level
// `TOTAL_LEVELS` "the level goes up by one". So the frame the cue owes itself to
// is the frame the snapshot reports the next level.
//
// The clear is reached by shooting the level's last segment away with a real
// bolt, which is the only route specs/progression.md gives: "a board that holds
// no worm segments and has had none removed is being played rather than
// cleared", so a posed-empty board would never clear and a check that read one
// would be reading nothing.
//
// The cut sounds on that same frame, and it must: a bolt destroyed a segment.
// This check therefore counts the level-clear cue rather than demanding silence
// around it — the cut is audio/cut's requirement, and a build that plays both is
// obeying both entries of the table. What is read here is that the clear sounds,
// exactly once, on the frame the level turns over.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The tile the level's last segment stands on, and the column the bolt climbs.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * nothing about the scenario turns on an edge case of the geometry.
 */
const SEGMENT_C = 20;
const SEGMENT_R = 10;

/** The level the clear is driven from — `startPlaying`'s own, and the run's first. */
const POSED_LEVEL = 1;

/** Rows the bolt is posed below the segment, so the clip opens on a shot climbing. */
const APPROACH_ROWS = 3;

/**
 * Frames the bolt is given to cover that approach.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so
 * `APPROACH_ROWS` tiles of `TILE` (`32`) units is `96 / 900` = `0.107` s. The
 * window is four times that: generous against a build that resolves its hit a
 * tile late, and far short of anything else on this posed board happening.
 */
const FLIGHT_TICKS = ticksFor((4 * APPROACH_ROWS * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the level-clear cue on the frame the level clears", async () => {
  startPlaying(h);
  // One segment, so removing it removes the last of the level's worm — which is
  // what specs/progression.md makes the clear.
  const worm = poseWorm(h, SEGMENT_C, SEGMENT_R, 1);
  h.debug.setWormStepping(worm, false);
  poseBoltAtTile(h, SEGMENT_C, SEGMENT_R + APPROACH_ROWS);
  assertEqual(
    h.snapshot().level,
    POSED_LEVEL,
    "the run stands on its first level before the clear",
  );

  // Subscribed after the board is posed, so what is read is the flight alone.
  const played = watchCues(h);
  const cleared = await h.until((s) => s.level > POSED_LEVEL, {
    maxFrames: FLIGHT_TICKS,
  });
  // Read on the frame the sweep stopped, which is the frame the level turned
  // over and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "clear");

  assertEqual(
    cleared.hit,
    true,
    "removing the last segment clears the level (specs/progression.md)",
  );
  const clears = played.filter((cue) => cue.cue === CUES.levelClear);
  assertLength(clears, 1, "the level-clear cue, once");
  assertEqual(
    clears[0].frame,
    frame,
    "the cue plays on the frame the level clears (specs/ui.md)",
  );
  assertGreaterThan(
    clears[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});

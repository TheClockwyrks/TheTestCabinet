// Wireworm — audio/cut: a bolt destroying a worm segment plays the `cut` cue,
// on the frame the segment is removed.
//
// specs/ui.md's cue table: "`cut` | `CUES.cut` | A bolt destroys a worm
// segment.", played "on the frame its event happens and at most once on that
// frame". The segment is destroyed by the build's own shot code — a real bolt
// climbs the column into it (specs/cursor.md) — so the frame the cue owes
// itself to is the frame the worm comes back one segment shorter.
//
// The worm is posed with TWO segments and the bolt aimed at the tail, because a
// worm all of whose segments are removed clears the level (specs/progression.md)
// and the level-clear sting is audio/level-clear's requirement, not this one. A
// build docked here is docked for the cut alone.
//
// Its step is held off as well. The requirement is what a BOLT does, so the
// worm is posed with only the faculty that requirement exercises: a worm that
// stepped away mid-flight would grade the shot's aim rather than the build's
// cue.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  ticksFor,
  watchCues,
  wormById,
  type Harness,
} from "../harness";

/**
 * The tile the tail stands on, and the column the bolt climbs.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * nothing about the scenario turns on an edge case of the geometry.
 */
const TAIL_C = 20;
const TAIL_R = 10;

/**
 * Rows the bolt is posed below the tail, so the clip opens on a shot in flight
 * rather than on one already touching what it destroys.
 */
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

it("plays the cut cue on the frame the segment is removed", async () => {
  startPlaying(h);
  // Head one column to the right of the tail, so the two segments lie along the
  // row and the bolt's column holds the tail and nothing else.
  const worm = poseWorm(h, TAIL_C + 1, TAIL_R, 2);
  h.debug.setWormStepping(worm, false);
  poseBoltAtTile(h, TAIL_C, TAIL_R + APPROACH_ROWS);
  assertEqual(
    wormById(h.snapshot(), worm)?.segments.length,
    2,
    "the posed worm stands two segments long before the shot",
  );

  // Subscribed after the board is posed, so what is read is the flight alone.
  const played = watchCues(h);
  const struck = await h.until(
    (s) => (wormById(s, worm)?.segments.length ?? 0) < 2,
    { maxFrames: FLIGHT_TICKS },
  );
  // Read on the frame the sweep stopped, which is the frame the segment left the
  // worm and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "cut");

  assertEqual(
    struck.hit,
    true,
    "the bolt destroys the segment in its column (specs/worm.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.cut],
    "the cut cue, once, and nothing else on an otherwise silent board",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame the segment is removed (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});

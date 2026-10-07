// Wireworm — audio/victory: clearing the worm at level `TOTAL_LEVELS` plays the
// `victory` sting, on the frame the victory screen opens.
//
// specs/ui.md's cue table: "`victory` | `CUES.victory` | The `victory` screen
// opens.", played "on the frame its event happens and at most once on that
// frame". specs/progression.md fixes when it opens: "Victory | The last worm
// segment of level `12` is removed. | The victory bonus is paid and the game
// moves to the `victory` screen." So the frame the sting owes itself to is the
// frame the snapshot reports `screen` as `victory`.
//
// The run is posed on level `TOTAL_LEVELS` and the last segment shot away with a
// real bolt, which is the only route specs/progression.md gives to the victory
// screen from play. It is the same drive as audio/level-clear's on a different
// level, and that is the point of the pair: a build that plays its clear cue on
// every clear including the last, and one that plays the sting on any clear at
// all, read differently from a build that sounds the run's end when the run ends.
//
// The clear and the cut sound on that same frame, and they may: a bolt destroyed
// a segment and a level cleared. This check therefore counts the victory sting
// rather than demanding silence around it — what is read is that the sting
// sounds, exactly once, on the frame the victory screen opens.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE, TOTAL_LEVELS } from "../constants";
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
 * The tile the last segment of the run stands on, and the column the bolt climbs.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * nothing about the scenario turns on an edge case of the geometry.
 */
const SEGMENT_C = 20;
const SEGMENT_R = 10;

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

it("plays the victory sting on the frame the victory screen opens", async () => {
  startPlaying(h);
  // The run's last level, so the clear below is the one that wins it.
  h.debug.setLevel(TOTAL_LEVELS);
  const worm = poseWorm(h, SEGMENT_C, SEGMENT_R, 1);
  h.debug.setWormStepping(worm, false);
  poseBoltAtTile(h, SEGMENT_C, SEGMENT_R + APPROACH_ROWS);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "the run is being played before the last segment goes",
  );

  // Subscribed after the board is posed, so what is read is the flight alone.
  const played = watchCues(h);
  const won = await h.until((s) => s.screen === "victory", {
    maxFrames: FLIGHT_TICKS,
  });
  // Read on the frame the sweep stopped, which is the frame the victory screen
  // opened and therefore the frame the sting owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "victory");

  assertEqual(
    won.hit,
    true,
    "removing the last segment of level 12 wins the run (specs/progression.md)",
  );
  const stings = played.filter((cue) => cue.cue === CUES.victory);
  assertLength(stings, 1, "the victory sting, once");
  assertEqual(
    stings[0].frame,
    frame,
    "the sting plays on the frame the victory screen opens (specs/ui.md)",
  );
  assertGreaterThan(
    stings[0].gain,
    0,
    "the sting is audible with the bus unmuted",
  );
});

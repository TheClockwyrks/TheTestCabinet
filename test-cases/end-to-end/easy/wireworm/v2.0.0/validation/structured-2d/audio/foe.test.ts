// Wireworm — audio/foe: a bolt destroying a foe plays the `foe` cue, on the
// frame the foe leaves the roster.
//
// specs/ui.md's cue table: "`foe` | `CUES.foe` | A foe is destroyed.", played
// "on the frame its event happens and at most once on that frame". The foe is
// destroyed by the build's own shot code — a real bolt climbs the column into
// the foe's box, `FOE_HALF` (`12`) units from its center on each axis
// (specs/cursor.md) — so the frame the cue owes itself to is the frame the
// roster comes back empty.
//
// The glitch is the foe posed, because specs/foes.md gives it "Bolts to destroy
// it | `1`": one bolt is the whole event, with no first-hit state in between
// that a build could sound the cue on instead. What the dropper's two bolts cost
// is the foes group's requirement, not this one's.
//
// Both of the glitch's faculties are held off. The requirement is what a BOLT
// does to a foe, so the foe is posed with none of the faculties the requirement
// does not exercise: a glitch left travelling would dart out of the bolt's
// column and grade the shot's aim, and one left thinking would eat the field it
// stands on and put another event on the board.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseFoe,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The tile the glitch stands on, and the column the bolt climbs.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * nothing about the scenario turns on an edge case of the geometry.
 */
const FOE_C = 20;
const FOE_R = 10;

/** Rows the bolt is posed below the foe, so the clip opens on a shot climbing. */
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

it("plays the foe cue on the frame the foe leaves the roster", async () => {
  startPlaying(h);
  const glitch = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);
  poseBoltAtTile(h, FOE_C, FOE_R + APPROACH_ROWS);
  assertEqual(
    h.snapshot().foes.length,
    1,
    "the posed board carries the one foe the shot is aimed at",
  );

  // Subscribed after the board is posed, so what is read is the flight alone.
  const played = watchCues(h);
  // One frame before the sweep, so the still below shows the foe the shot is
  // aimed at with the bolt under it, rather than the empty board the kill
  // leaves behind. Nothing on this board can sound in that frame, so it is
  // inside the section the cues are read over rather than outside it.
  await h.advance(1);
  captureStill(h, "kill");
  const killed = await h.until((s) => s.foes.length === 0, {
    maxFrames: FLIGHT_TICKS,
  });
  // Read on the frame the sweep stopped, which is the frame the foe left the
  // roster and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;

  assertEqual(
    killed.hit,
    true,
    "one bolt destroys the glitch it strikes (specs/foes.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.foe],
    "the foe cue, once, and nothing else on an otherwise silent board",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame the foe is destroyed (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});

// Wireworm — audio/discharge: a bolt into a critical node plays the `discharge`
// cue, on the frame the chain runs.
//
// specs/ui.md's cue table: "`discharge` | `CUES.discharge` | A detonation's
// chain runs.", played "on the frame its event happens and at most once on that
// frame". specs/discharge.md fixes the event: a bolt into a node at
// `CHARGE_MAX` detonates it, and "the whole chain resolves at the moment the
// bolt strikes, within the same update". So the frame the cue owes itself to is
// the frame the struck node leaves the board.
//
// The board carries TWO nodes, not one: the critical node the bolt strikes and a
// neighbour at charge `2` one tile away, inside `DISCHARGE_RADIUS` (`2`) of it.
// So the chain conducts a real link rather than detonating in isolation, and a
// build that reads "a detonation's chain runs" as needing something to chain to
// is held to the same reading as one that plays the cue on the strike itself.
// The neighbour sits in the next COLUMN, so the bolt cannot reach it: the bolt
// resolves against exactly one thing (specs/cursor.md), and that one thing is
// the critical node.
//
// The neighbour is posed at `2` rather than at `3`, because a second critical
// node would raise the question of which detonation the cue belongs to. At `2`
// it conducts and is consumed, and nothing on this board ever REACHES charge
// `3` during the drive — so the critical cue, whose own item is audio/critical,
// cannot sound here and confuse the reading.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CHARGE_MAX, CUES, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The tile the critical node stands on, and the column the bolt climbs.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * the `5 x 5` block specs/discharge.md reaches through lies wholly on the board.
 */
const STRUCK_C = 20;
const STRUCK_R = 10;

/**
 * The charge the conducting neighbour is posed at.
 *
 * specs/discharge.md conducts to "every node at charge `1` or above", so `2` is
 * squarely inside the rule while staying clear of `CHARGE_MAX`, which would put
 * a second critical node on the board.
 */
const NEIGHBOUR_CHARGE = 2;

/** Rows the bolt is posed below the node, so the clip opens on a shot climbing. */
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

it("plays the discharge cue on the frame the chain runs", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(STRUCK_C + 1, STRUCK_R, NEIGHBOUR_CHARGE);
  poseBoltAtTile(h, STRUCK_C, STRUCK_R + APPROACH_ROWS);
  assertEqual(
    chargeAt(h.snapshot(), STRUCK_C, STRUCK_R),
    CHARGE_MAX,
    "the posed node stands critical before the shot",
  );

  // Subscribed after the board is posed, so what is read is the flight alone.
  const played = watchCues(h);
  const detonated = await h.until(
    (s) => chargeAt(s, STRUCK_C, STRUCK_R) === null,
    { maxFrames: FLIGHT_TICKS },
  );
  // Read on the frame the sweep stopped, which is the frame the struck node left
  // the board and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "discharge");

  assertEqual(
    detonated.hit,
    true,
    "the bolt detonates the critical node it strikes (specs/discharge.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.discharge],
    "the discharge cue, once, and nothing else on an otherwise silent board",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame the chain runs (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});

// Wireworm — audio/critical: a node reaching charge `3` plays the `critical`
// cue, on the frame it reaches it and only then.
//
// specs/ui.md's cue table: "`critical` | `CUES.critical` | A node reaches charge
// `3`.", played "on the frame its event happens and at most once on that frame".
// The word the cue turns on is REACHES: a node already standing at `CHARGE_MAX`
// is not reaching it, so a build that announces the state rather than the
// transition is a different build from one that announces the event.
//
// The route is the corruptor, which specs/foes.md states outright: "A corruptor
// sets the node on the tile its center occupies to `CHARGE_MAX` (`3`), whatever
// charge that node held", and "A foe standing still therefore acts on the one
// tile it stands on". So the whole scenario is one node and one corruptor over
// it, with the foe's travel held off and its mind left running — the two
// faculties specs/instrumentation.md gates separately, posed so the only thing
// that can move on this board is the node's charge.
//
// The node is posed at `2` rather than at `0` or `1`, because `2` is the value
// from which a single slam reaches critical and a build that instead raised the
// charge one level at a time would ALSO reach it — so the cue, not the arithmetic,
// is what this check turns on. What a slam does to the field is
// nodes/foes' requirement; what it sounds like is this one's.
//
// The drive runs a quarter of a second past the slam. The corruptor is still
// sitting on the node for every frame of it, so a build that plays the cue while
// a node IS critical rather than when it reaches critical is caught by the
// count.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, CUES } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseFoe,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The tile the node and the corruptor share.
 *
 * A tile in the middle of the board: clear of row `0` the worm enters along, of
 * the player band's rows `18`–`19`, and of both side edges (specs/board.md), so
 * nothing about the scenario turns on an edge case of the geometry.
 */
const NODE_C = 20;
const NODE_R = 10;

/**
 * The charge the node is posed at: one below `CHARGE_MAX`, so the corruptor's
 * slam is what takes it to critical and the reading is that one transition.
 */
const POSED_CHARGE = CHARGE_MAX - 1;

/**
 * Frames the corruptor is given to act on the tile it stands on.
 *
 * It acts on each update (specs/foes.md), so the slam lands on the first frame
 * that runs; a quarter of a second is thirty frames of slack around that.
 */
const SLAM_TICKS = ticksFor(0.25);

/**
 * Frames watched after the node reaches critical, with the corruptor still on it.
 *
 * A quarter of a second — thirty frames in which a build that announces the
 * state rather than the transition would announce it thirty more times.
 */
const TAIL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the critical cue once, on the frame the node reaches charge 3", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);
  const corruptor = poseFoe(h, "corruptor", NODE_C, NODE_R);
  // Its mind is the faculty under test and stays on; its travel is the one that
  // would carry it off the tile, so that is the one held off.
  h.debug.setFoeTravel(corruptor, false);
  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    POSED_CHARGE,
    "the posed node stands one charge below critical",
  );

  // Subscribed after the board is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const slammed = await h.until(
    (s) => chargeAt(s, NODE_C, NODE_R) === CHARGE_MAX,
    { maxFrames: SLAM_TICKS },
  );
  // Read on the frame the sweep stopped, which is the frame the node reached
  // critical and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;
  await h.advance(TAIL_TICKS);
  captureStill(h, "critical");

  assertEqual(
    slammed.hit,
    true,
    "the corruptor slams the node it stands on to CHARGE_MAX (specs/foes.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.critical],
    "the critical cue, once, and nothing else while the corruptor holds the tile",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame the node reaches charge 3 (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});

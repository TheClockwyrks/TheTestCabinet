// audio/critical — a node reaching critical plays the critical cue.
//
// specs/ui.md fixes `CUES.critical` (`"critical"`) as the cue played when "a node
// reaches charge `3`", and governs all ten with one sentence: "Each is played on
// the frame its event happens and at most once on that frame."
//
// So the measurement is: let one worm bump one node from `2` to `CHARGE_MAX`, step
// one frame at a time, and read what sounded on the frame the node reached
// critical against what sounded over the frames before it.
//
// THE NODE IS POSED AT `2`, WHICH IS THE ONLY VALUE THAT READS. specs/nodes.md has
// a blocked head raise the node it was blocked by "by one charge, capped at
// `CHARGE_MAX`", so a node posed at `2` reaches critical on its first bump and on
// no earlier event. Posed at `3` there would be nothing to reach; posed lower the
// bump would leave it short, and the check would be reading the absence of a cue.
//
// THE WORM IS A HEAD ALONE, HELD STILL, AND THEN LET GO. It is posed on the tile
// beside the node with its horizontal heading pointing into it and its step
// faculty off, so the whole quiet lead runs on exactly the board the event is then
// staged on: a build that sounds the cue from a worm merely standing beside a
// charged node is caught there. Arming is one field, `setWormStepping`, and
// specs/worm.md then has the head's first step blocked by the node and the node
// bumped on that step.
//
// ONE SEGMENT, so the level cannot clear under the reading and no body follows
// anything; and row 10, in the open middle of the board, so the block is by the
// node rather than by an edge (specs/board.md, specs/worm.md).
//
// WHAT THIS DOES NOT DECIDE. That a block raises a node's charge at all, and that
// the rise caps at `CHARGE_MAX`, are `nodes.bump-charges`'s and
// `nodes.bump-caps`'s requirements; that the step faculty gates the step is
// `instrumentation.worm-stepping-gate`'s. This point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, CUES, wormStepInterval } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The tile the node stands on, and the tile the worm's head waits on.
 *
 * Row 10 is in the open middle of the board, clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md). The head stands one tile to
 * the left heading right, so the tile its next step targets is the node's.
 */
const NODE_C = 20;
const NODE_R = 10;
const HEAD_C = NODE_C - 1;

/** The charge the node is posed at, one below critical. */
const POSED_CHARGE = CHARGE_MAX - 1;

/** The level the scenario runs at, and the step interval that level fixes. */
const LEVEL = 1;
const STEP_INTERVAL = wormStepInterval(LEVEL);

/**
 * Frames of silence driven on the posed board before the worm is let go.
 *
 * A whole `wormStepInterval(1)` (`0.14` s), which is the cadence the worm itself
 * would step at, so a build sounding the cue on its worm's clock rather than on
 * the charge reaching critical has to get through a window as long as its own step
 * period without sounding anything.
 */
const QUIET_LEAD = ticksFor(STEP_INTERVAL);

/**
 * Frames the worm is given to take its blocked step.
 *
 * specs/worm.md starts a worm's step clock "at zero when the worm comes into
 * existence" and steps it every `wormStepInterval(level)`, so a conforming build
 * takes the blocking step within one interval of the faculty being turned back on,
 * whether or not the clock ran while it was off. Three intervals is a hard ceiling
 * well past that, so a build whose worm never steps still reaches a verdict rather
 * than running the suite out.
 */
const STEP_FRAMES = 3 * ticksFor(STEP_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.critical on the frame a bumped node reaches CHARGE_MAX, and not before", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);
  const worm = poseWorm(h, HEAD_C, NODE_R, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    POSED_CHARGE,
    `posing: the node at (${String(NODE_C)}, ${String(NODE_R)}) stands one ` +
      "charge below critical (specs/instrumentation.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => chargeAt(s, NODE_C, NODE_R) === CHARGE_MAX,
    QUIET_LEAD + STEP_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        h.debug.setWormStepping(worm, true);
      },
    },
  );
  captureStill(h, "critical");

  assertEqual(
    watch.hit,
    true,
    `the blocked head raised the node to CHARGE_MAX inside the ` +
      `${String(STEP_FRAMES)} frames the check allows its step, which is ` +
      `three times the level ${String(LEVEL)} step interval (specs/worm.md, ` +
      "specs/nodes.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.critical),
    0,
    `times CUES.critical played over the ${String(watch.at - 1)} frames ` +
      "before the node reached critical (specs/ui.md: a cue is played on the " +
      "frame its event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.critical),
    1,
    "times CUES.critical played on the frame the node reached CHARGE_MAX, " +
      "which is its own frame and at most once on it (specs/ui.md)",
  );
});

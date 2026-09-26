// audio/discharge — a chain-arc discharge plays the discharge cue.
//
// specs/ui.md fixes `CUES.discharge` (`"discharge"`) as the cue played when "a
// detonation's chain runs", and governs all ten with one sentence: "Each is played
// on the frame its event happens and at most once on that frame."
//
// So the measurement is: fly one bolt into a critical node, step one frame at a
// time, and read what sounded on the frame the chain resolved against what sounded
// over the frames of the flight before it.
//
// TWO CRITICAL NODES, NOT ONE. specs/discharge.md has the struck node detonate and
// then arc to every charged node within `DISCHARGE_RADIUS` (`2`) tiles, and has
// the whole chain resolve "within the same update". A neighboring critical node
// therefore makes this a chain that conducts a link rather than a lone detonation,
// which is what the cue is named for, and it separates a build that sounds the cue
// once per chain from one that sounds it once per node detonated: the latter reads
// `2` on the event's frame, and "at most once on that frame" is the sentence it
// fails.
//
// THE READING IS THE CHAIN RESOLVING. Both nodes leave the board on the update the
// bolt strikes (specs/discharge.md: a detonated node "is removed from the board,
// and its tile is left empty"), so an empty node field is the chain having run,
// read from the same snapshot the cue is attributed to.
//
// THE NEIGHBOR IS OUT OF THE BOLT'S COLUMN. It stands one tile to the side, so
// specs/cursor.md leaves the struck node the first thing the bolt's center reaches
// and the second node is reached only by the chain.
//
// WHAT THIS DOES NOT DECIDE. That the chain reaches, floods and stops where
// specs/discharge.md says are the `discharge.*` points' requirements, and that the
// purge pays `SCORE_PURGE_NODE` is `scoring.purge-node`'s. This point reads the
// cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CHARGE_MAX, CUES, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The tile the struck node stands on, and the neighbor the chain conducts to.
 *
 * Row 10 is in the open middle of the board, clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md). The neighbor is one tile to
 * the side, a Chebyshev distance of `1` and so well inside `DISCHARGE_RADIUS`.
 */
const STRUCK_C = 20;
const STRUCK_R = 10;
const NEIGHBOR_C = STRUCK_C + 1;

/** How many nodes the pose puts on the board, all of them critical. */
const POSED_NODES = 2;

/** How far below the struck node the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the node, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's center is inside the node's tile". Posed four tiles
 * below it, its center starts `3.5` tiles, `112` units, under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_FRAMES = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/**
 * Frames of silence driven on the posed board before the bolt is put in flight.
 *
 * As long as the flight itself, so the window the check requires quiet across is
 * the same size as the window it looks for the detonation in.
 */
const QUIET_LEAD = BOLT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.discharge on the frame the chain runs, and not before", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(NEIGHBOR_C, STRUCK_R, CHARGE_MAX);
  assertEqual(
    h.snapshot().nodes.length,
    POSED_NODES,
    "posing: the board carries the two critical nodes the chain runs through " +
      "and nothing else (specs/instrumentation.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.nodes.length === 0,
    QUIET_LEAD + BOLT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        poseBolt(h, STRUCK_C, STRUCK_R + BOLT_DROP_TILES);
      },
    },
  );
  captureStill(h, "discharge");

  assertEqual(
    watch.hit,
    true,
    `the chain detonated both critical nodes inside the ` +
      `${String(BOLT_FRAMES)} frames of flight the check allows the bolt from ` +
      `${String(BOLT_DROP_TILES)} tiles below the struck node ` +
      "(specs/discharge.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.discharge),
    0,
    `times CUES.discharge played over the ${String(watch.at - 1)} frames ` +
      "before the chain ran (specs/ui.md: a cue is played on the frame its " +
      "event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.discharge),
    1,
    "times CUES.discharge played on the frame the chain ran, which is its " +
      "own frame and at most once on it, however many nodes the chain " +
      "detonated (specs/ui.md)",
  );
});

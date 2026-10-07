// Wireworm — screens/pause-freezes-worm: the worm takes no step while the game
// is paused.
//
// specs/ui.md's `paused` screen: the board "is frozen: no worm steps, no foe
// moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THIS ONE DECIDES THE WORM, and the board carries nothing else: no foe, no
// bolt, no node. `startPlaying` shuts the three world gates, so no spawner, no
// level worm and no contact can reach into the paused stretch and move something
// this check would then blame the pause for.
//
// THE SCENARIO IS A BOARD THAT IS DEMONSTRABLY MOVING. A worm sitting still
// while paused says nothing unless it was stepping a moment earlier, so the
// board is driven through `LIVE_FRAMES` of real play first and the tiles at the
// pause are checked against the ones the worm was posed on. That is the
// scenario's precondition rather than a second requirement: a build whose worm
// never steps at all is failed by the `worm` items that grade the step.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  chebyshev,
  createHarness,
  framesFor,
  framesForSteps,
  poseWorm,
  requireWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { PAUSE_KEY } from "./screens";

/** The level the board is posed at, and so the step interval the worm keeps. */
const LEVEL = 1;

/** The worm's head and its length: clear of every edge. */
const WORM_C = 8;
const WORM_R = 4;
const WORM_LENGTH = 3;

/**
 * The live frames driven before the pause.
 *
 * Enough for two of the level's tile steps, so the worm is visibly walking when
 * the pause lands. `framesForSteps` stops half an interval past the second step,
 * which is the furthest point from either step boundary.
 */
const LIVE_FRAMES = framesForSteps(2, LEVEL);

/**
 * The paused game time the freeze is read over: one second.
 *
 * It is more than seven of the level's `0.14` s tile steps (specs/worm.md) and
 * more than sixty of the frames the drive is made of, so a build that leaked any
 * fraction of the pause into its simulation has stepped by the end of it.
 */
const PAUSED_FRAMES = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the worm on its tiles for a paused second", async () => {
  await startPlaying(h, { level: LEVEL });
  const wormId = await poseWorm(h, {
    c: WORM_C,
    r: WORM_R,
    length: WORM_LENGTH,
  });

  // One recording over the whole thing: a worm hanging still only reads as
  // HANGING beside the play it was stopped out of.
  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_FRAMES);
    await h.tap(PAUSE_KEY);
    const at = await h.snapshot();
    await h.advance(PAUSED_FRAMES);
    return at;
  });

  assertEqual(paused.screen, "paused", "the screen the pause key left");

  // The precondition: the worm really was walking when the pause landed.
  const atPause = requireWorm(paused, wormId);
  assertGreaterThanOrEqual(
    chebyshev(atPause.segments[0], { c: WORM_C, r: WORM_R }),
    1,
    "the worm had stepped off its posed tile before the pause",
  );

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused second");
  assertDeepEqual(
    requireWorm(after, wormId).segments,
    atPause.segments,
    "the worm's tiles after a paused second (specs/ui.md)",
  );
});

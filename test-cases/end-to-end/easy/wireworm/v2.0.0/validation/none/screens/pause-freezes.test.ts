// Wireworm — screens/pause-freezes: nothing on the board moves while the game is
// paused.
//
// specs/ui.md's `paused` screen: "The board stays visible behind the menu and is
// frozen: no worm steps, no foe moves, no bolt travels, no phase timer runs, and
// no cue plays, so a paused game is exactly where it was when it was paused."
// This item decides the two halves the manifest names — the worm takes no step,
// and no foe moves.
//
// THE SCENARIO IS A BOARD THAT IS DEMONSTRABLY MOVING. A worm sitting still
// while paused says nothing unless it was stepping a moment earlier, so the
// board is driven through `LIVE_FRAMES` of real play first and the reading at
// the pause is checked against the tiles the worm was posed on. That is the
// scenario's precondition rather than a second requirement: a build whose worm
// never steps at all is failed by the `worm` items that grade the step.
//
// THE FOE TRAVELS WITH ITS MIND OFF. `specs/foes.md` gives the glitch two
// faculties, its dart re-pick and its eating, and neither is what "no foe moves"
// is about — so the glitch is posed with `mind: false` and `travel` left on, and
// the only thing that can change its position is the locomotion this item
// decides. The board holds no node, so there is nothing for it to eat either
// way.
//
// The three world gates are shut by `startPlaying`, so no spawner, no level
// worm and no contact can reach into the paused stretch and move something this
// check would then blame the pause for.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { GLITCH_V_SPEED } from "../constants";
import {
  captureReplay,
  chebyshev,
  createHarness,
  framesFor,
  framesForSteps,
  poseFoe,
  poseWorm,
  requireFoe,
  requireWorm,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import { PAUSE_KEY } from "./screens";

/** The level the board is posed at, and so the step interval the worm keeps. */
const LEVEL = 1;

/** The worm's head, its length, and the foe's tile: all clear of every edge. */
const WORM_C = 8;
const WORM_R = 4;
const WORM_LENGTH = 3;
const FOE_C = 20;
const FOE_R = 6;

/**
 * The live frames driven before the pause.
 *
 * Enough for two of the level's tile steps, so the worm is visibly walking when
 * the pause lands. `framesForSteps` stops half an interval past the second step,
 * which is the furthest point from either step boundary.
 */
const LIVE_FRAMES = framesForSteps(2, LEVEL);

/**
 * The paused game time the freeze is read over: one second, which is what the
 * item states.
 *
 * It is more than seven of the level's `0.14` s tile steps (specs/worm.md) and
 * more than sixty of the frames the drive is made of, so a build that leaked any
 * fraction of the pause into its simulation has moved something by the end of
 * it.
 */
const PAUSED_FRAMES = framesFor(1);

/**
 * How far the foe must have travelled before the pause for the reading after it
 * to mean anything, in logical units.
 *
 * specs/foes.md descends a glitch at `GLITCH_V_SPEED` (`62`) units per second,
 * so the live stretch alone carries it that far down before any horizontal
 * motion is counted at all. A quarter of that is asked for, which is far above
 * any rounding and far below what a conforming build produces.
 */
const MOVED_MIN = 0.25 * GLITCH_V_SPEED * seconds(LIVE_FRAMES);

/**
 * How closely a frozen foe must be reported where it was, in decimal places.
 *
 * Six places is a tolerance of `5e-7` units — the freeze is exact, and this is
 * room for nothing but the JSON round trip out of the page. specs/foes.md moves
 * a glitch horizontally at `210` units per second, so a single leaked frame of
 * the drive's `0.01` s would move it `2.1` units, four million times this.
 */
const FROZEN_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the worm and the foe exactly where they were for a paused second", async () => {
  await startPlaying(h, { level: LEVEL });
  const wormId = await poseWorm(h, {
    c: WORM_C,
    r: WORM_R,
    length: WORM_LENGTH,
  });
  const foeId = await poseFoe(h, "glitch", FOE_C, FOE_R, { mind: false });
  const posedFoe = requireFoe(await h.snapshot(), foeId);

  // One recording over the whole thing: a board hanging still only reads as
  // HANGING beside the play it was stopped out of.
  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_FRAMES);
    await h.tap(PAUSE_KEY);
    const at = await h.snapshot();
    await h.advance(PAUSED_FRAMES);
    return at;
  });

  assertEqual(paused.screen, "paused", "the screen the pause key left");

  // The precondition: the board really was moving when the pause landed.
  const wormAtPause = requireWorm(paused, wormId);
  const foeAtPause = requireFoe(paused, foeId);
  assertGreaterThanOrEqual(
    chebyshev(wormAtPause.segments[0], { c: WORM_C, r: WORM_R }),
    1,
    "the worm had stepped off its posed tile before the pause",
  );
  assertGreaterThan(
    Math.hypot(foeAtPause.x - posedFoe.x, foeAtPause.y - posedFoe.y),
    MOVED_MIN,
    "the foe had travelled before the pause",
  );

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused second");
  assertDeepEqual(
    requireWorm(after, wormId).segments,
    wormAtPause.segments,
    "the worm's tiles after a paused second",
  );
  const foeAfter = requireFoe(after, foeId);
  assertCloseTo(foeAfter.x, foeAtPause.x, FROZEN_DIGITS, "the foe's x");
  assertCloseTo(foeAfter.y, foeAtPause.y, FROZEN_DIGITS, "the foe's y");
});

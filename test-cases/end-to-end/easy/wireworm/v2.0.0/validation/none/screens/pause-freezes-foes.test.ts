// Wireworm — screens/pause-freezes-foes: no foe moves while the game is paused.
//
// specs/ui.md's `paused` screen: the board "is frozen: no worm steps, no foe
// moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THIS ONE DECIDES THE FOE, and the board carries nothing else: no worm, no
// bolt, no node. `startPlaying` shuts the three world gates, so no spawner, no
// level worm and no contact can reach into the paused stretch.
//
// THE FOE TRAVELS WITH ITS MIND OFF. `specs/foes.md` gives the glitch two
// faculties, its dart re-pick and its eating, and neither is what "no foe moves"
// is about — so the glitch is posed with `mind: false` and `travel` left on, and
// the only thing that can change its position is the locomotion this item
// decides. The board holds no node, so there is nothing for it to eat either
// way.
//
// THE SCENARIO IS A BOARD THAT IS DEMONSTRABLY MOVING. A foe sitting still while
// paused says nothing unless it was travelling a moment earlier, so the board is
// driven through `LIVE_FRAMES` of real play first and the distance covered is
// checked before the freeze is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { GLITCH_V_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import { PAUSE_KEY } from "./screens";

/** The level the board is posed at. */
const LEVEL = 1;

/** The foe's tile: clear of every edge, with room below it to descend into. */
const FOE_C = 20;
const FOE_R = 6;

/** The live frames driven before the pause: enough to carry the foe visibly. */
const LIVE_FRAMES = framesFor(0.4);

/**
 * The paused game time the freeze is read over: one second.
 *
 * More than sixty of the frames the drive is made of, so a build that leaked any
 * fraction of the pause into its simulation has moved the foe by the end of it.
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
  await h?.dispose();
});

it("holds the foe exactly where it was for a paused second", async () => {
  await startPlaying(h, { level: LEVEL });
  const foeId = await poseFoe(h, "glitch", FOE_C, FOE_R, { mind: false });
  const posedFoe = requireFoe(await h.snapshot(), foeId);

  // One recording over the whole thing: a foe hanging still only reads as
  // HANGING beside the travel it was stopped out of.
  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_FRAMES);
    await h.tap(PAUSE_KEY);
    const at = await h.snapshot();
    await h.advance(PAUSED_FRAMES);
    return at;
  });

  assertEqual(paused.screen, "paused", "the screen the pause key left");

  // The precondition: the foe really was travelling when the pause landed.
  const foeAtPause = requireFoe(paused, foeId);
  assertGreaterThan(
    Math.hypot(foeAtPause.x - posedFoe.x, foeAtPause.y - posedFoe.y),
    MOVED_MIN,
    "the foe had travelled before the pause",
  );

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused second");
  const foeAfter = requireFoe(after, foeId);
  assertCloseTo(
    foeAfter.x,
    foeAtPause.x,
    FROZEN_DIGITS,
    "the foe's x after a paused second (specs/ui.md)",
  );
  assertCloseTo(
    foeAfter.y,
    foeAtPause.y,
    FROZEN_DIGITS,
    "the foe's y after a paused second (specs/ui.md)",
  );
});

// Wireworm — screens/pause-freezes-bolts: no bolt travels while the game is
// paused.
//
// specs/ui.md's `paused` screen: the board "is frozen: no worm steps, no foe
// moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THIS ONE DECIDES THE BOLT, and the board carries nothing else: no worm, no
// foe, no node. That empty column matters twice over — a bolt resolves against
// the first thing it meets (`specs/cursor.md`), so on a board holding nothing it
// can only travel, and its position is a reading of the freeze alone.
//
// THE SCENARIO IS A BOLT THAT IS DEMONSTRABLY CLIMBING. A bolt hanging still
// while paused says nothing unless it was moving a moment earlier, so it is
// posed low on the board and flown through `LIVE_FRAMES` of real play before the
// pause lands.
//
// A LEAKED FRAME IS LOUD HERE. `BOLT_SPEED` is `900` units per second, so a
// build that ran its simulation behind the menu has flown the bolt off the top
// of the board inside the paused second and reports no bolt at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan, fail } from "../assert";
import { BOLT_SPEED } from "../constants";
import {
  boltById,
  captureReplay,
  createHarness,
  framesFor,
  poseBolt,
  seconds,
  startPlaying,
  type BoltView,
  type Harness,
  type WirewormSnapshot,
} from "../harness";
import { PAUSE_KEY } from "./screens";

/** Where the bolt is posed: low on an empty board, with the whole column clear. */
const BOLT_C = 20;
const BOLT_R = 18;

/** The live frames driven before the pause: enough to carry the bolt visibly. */
const LIVE_FRAMES = framesFor(0.15);

/**
 * The paused game time the freeze is read over: one second.
 *
 * `BOLT_SPEED` (`900`) carries a bolt the whole height of the board in well
 * under that, so a build leaking any real fraction of it has lost the bolt.
 */
const PAUSED_FRAMES = framesFor(1);

/**
 * How far the bolt must have climbed before the pause for the reading after it
 * to mean anything, in logical units.
 *
 * A quarter of what `BOLT_SPEED` covers over the live stretch: far above any
 * rounding, and far below what a conforming build produces.
 */
const CLIMBED_MIN = 0.25 * BOLT_SPEED * seconds(LIVE_FRAMES);

/**
 * How closely a frozen bolt must be reported where it was, in decimal places.
 *
 * Six places is a tolerance of `5e-7` units — the freeze is exact, and this is
 * room for nothing but the JSON round trip out of the page.
 */
const FROZEN_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** The posed bolt, failing where it is no longer in flight. */
function requireBolt(snapshot: WirewormSnapshot, id: number): BoltView {
  const bolt = boltById(snapshot, id);
  if (bolt === undefined) {
    fail(
      "the posed bolt still in flight (specs/ui.md)",
      "no bolt in the roster carries its id",
    );
  }
  return bolt;
}

it("holds the bolt exactly where it was for a paused second", async () => {
  await startPlaying(h);
  const boltId = await poseBolt(h, BOLT_C, BOLT_R);
  const posed = requireBolt(await h.snapshot(), boltId);

  // One recording over the whole thing: a bolt hanging still only reads as
  // HANGING beside the flight it was stopped out of.
  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_FRAMES);
    await h.tap(PAUSE_KEY);
    const at = await h.snapshot();
    await h.advance(PAUSED_FRAMES);
    return at;
  });

  assertEqual(paused.screen, "paused", "the screen the pause key left");

  // The precondition: the bolt really was climbing when the pause landed.
  const atPause = requireBolt(paused, boltId);
  assertGreaterThan(
    posed.y - atPause.y,
    CLIMBED_MIN,
    "the bolt had climbed before the pause",
  );

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused second");
  const boltAfter = requireBolt(after, boltId);
  assertCloseTo(
    boltAfter.x,
    atPause.x,
    FROZEN_DIGITS,
    "the bolt's x after a paused second (specs/ui.md)",
  );
  assertCloseTo(
    boltAfter.y,
    atPause.y,
    FROZEN_DIGITS,
    "the bolt's y after a paused second (specs/ui.md)",
  );
});

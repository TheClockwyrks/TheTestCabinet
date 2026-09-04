// Wireworm — screens/pause-freezes-bolts: no bolt travels while the game is
// paused.
//
// `specs/ui.md` on the `paused` screen: the board "is frozen: no worm steps, no
// foe moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THE WORLD POSED. One bolt on an empty, quiet board — no worm, no foe, no
// scattered field, no spawning, no entry, no contact. That empty column matters
// twice over: a bolt resolves against the first thing it meets
// (`specs/cursor.md`), so on a board holding nothing it can only travel, and its
// position is a reading of the freeze alone.
//
// THE MOTION IS PROVED FIRST. A bolt hanging still while paused says nothing
// unless it was climbing a moment earlier, so it is posed low on the board and
// flown through LIVE_TICKS of real play before the pause lands.
//
// A LEAKED FRAME IS LOUD HERE. `BOLT_SPEED` is `900` units per second
// (specs/cursor.md), so a build that ran its simulation behind the menu flew
// the bolt off the top of the board inside the paused stretch and reports no
// bolt at all.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED } from "../constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  boltById,
  captureReplay,
  createHarness,
  poseBoltAtTile,
  resetTo,
  seconds,
  startPlaying,
  tapAction,
  ticksFor,
  type BoltSnapshot,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** Where the bolt is posed: low on an empty board, with the whole column clear. */
const BOLT_C = 20;
const BOLT_R = 18;

/** Live flight before the pause: 0.15 s, which is several tiles of climb. */
const LIVE_TICKS = ticksFor(0.15);

/** The paused stretch the item names: over a second of game time. */
const PAUSED_TICKS = ticksFor(1.2);

/**
 * How far the bolt must have climbed over the live stretch to prove it was, in
 * logical units.
 *
 * A quarter of what `BOLT_SPEED` covers over it: far above any rounding, and far
 * below what a conforming build produces.
 */
const CLIMBED_MIN = 0.25 * BOLT_SPEED * seconds(LIVE_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The posed bolt, failing where it is no longer in flight. */
function bolt(snapshot: WirewormSnapshot, id: number): BoltSnapshot {
  const found = boltById(snapshot, id);
  if (found === undefined) {
    fail(
      "the posed bolt still in flight: a paused board travels no bolt " +
        "(specs/ui.md)",
      "no bolt in the roster carries its id",
    );
  }
  return found;
}

it("travels no bolt over a second of paused game time", async () => {
  resetTo(h);
  startPlaying(h);
  const shot = poseBoltAtTile(h, BOLT_C, BOLT_R);
  const opened = bolt(h.snapshot(), shot);

  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_TICKS);
    const live = h.snapshot();
    await tapAction(h, "pause");
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return { live, at };
  });

  // The precondition: the bolt really was climbing before the pause.
  assertGreaterThan(
    opened.y - bolt(paused.live, shot).y,
    CLIMBED_MIN,
    "the bolt climbs over the live stretch before the pause",
  );

  assertEqual(
    paused.at.screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );

  // The verdict: a second of paused game time later, nothing has moved.
  const later = h.snapshot();
  assertEqual(later.screen, "paused", "the game is still paused");

  const atBolt = bolt(paused.at, shot);
  const laterBolt = bolt(later, shot);
  assertEqual(
    laterBolt.x,
    atBolt.x,
    "the bolt holds its x while the game is paused (specs/ui.md)",
  );
  assertEqual(
    laterBolt.y,
    atBolt.y,
    "the bolt holds its y while the game is paused (specs/ui.md)",
  );
});

// Wireworm — screens/pause-freezes-worm: the worm takes no step while the game
// is paused.
//
// `specs/ui.md` on the `paused` screen: the board "is frozen: no worm steps, no
// foe moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THE WORLD POSED. One worm of a single segment on an empty, quiet board — no
// foe, no bolt, no scattered field, no spawning, no entry, no contact — so the
// only thing that can move is the one this item names.
//
// THE MOTION IS PROVED FIRST. A board where nothing was moving is frozen by
// doing nothing at all, so the drive runs LIVE_TICKS of live play first and the
// check asserts the worm really stepped over it. LIVE_TICKS covers 0.4 s, which
// is nearly three of level 1's 0.14 s worm steps (`src/constants.ts`,
// WORM_STEP_L1) — long enough that a worm stepping at anything near the stated
// rate has stepped, and short enough to leave it clear of the walls.
//
// THE FREEZE IS EXACT. A tile is a whole number, so the readings after the pause
// are compared for equality. The pause is raised by the `pause` action's own
// first bound key — `KeyP`, which drives nothing else — as a real key event.
//
// The recording spans the live stretch as well as the paused one, because a
// worm hanging still is only visibly HANGING beside the play it was stopped out
// of.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  headOf,
  poseWorm,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";

/** Where the worm's head is posed: clear of every wall, on an empty board. */
const WORM_C = 8;
const WORM_R = 6;

/** Live play before the pause: 0.4 s, nearly three of level 1's worm steps. */
const LIVE_TICKS = ticksFor(0.4);

/** The paused stretch the item names: over a second of game time. */
const PAUSED_TICKS = ticksFor(1.2);

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const PAUSE_KEY = "KeyP";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes no worm step over a second of paused game time", async () => {
  startPlaying(h);
  const worm = poseWorm(h, WORM_C, WORM_R, 1);

  const openedHead = headOf(wormOf(h.snapshot(), worm));

  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_TICKS);
    const live = h.snapshot();
    await h.tap(PAUSE_KEY);
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return { live, at };
  });

  // The precondition: the worm really was walking before the pause.
  const liveHead = headOf(wormOf(paused.live, worm));
  assertEqual(
    liveHead.c === openedHead.c && liveHead.r === openedHead.r,
    false,
    "the worm steps off its tile over the live stretch before the pause",
  );

  assertEqual(
    paused.at.screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );

  // The verdict: a second of paused game time later, nothing has moved.
  const later = h.snapshot();
  assertEqual(later.screen, "paused", "the game is still paused");

  const atHead = headOf(wormOf(paused.at, worm));
  const laterHead = headOf(wormOf(later, worm));
  assertEqual(
    laterHead.c,
    atHead.c,
    "the worm's head holds its column while the game is paused (specs/ui.md)",
  );
  assertEqual(
    laterHead.r,
    atHead.r,
    "the worm's head holds its row while the game is paused (specs/ui.md)",
  );
});

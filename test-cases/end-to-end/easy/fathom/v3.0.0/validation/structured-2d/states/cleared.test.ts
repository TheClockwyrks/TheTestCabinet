// states/cleared — the cleared interstitial names the depth it just cleared.
//
// `specs/progression.md`: "A maze is cleared when the forager eats a plankton and
// none remain in the maze after it. Clearing awards the `SCORE_CLEAR` bonus and
// `screen` becomes `"cleared"`". `specs/ui.md` gives that screen as "the
// interstitial after a maze is cleared, over the maze view, naming the depth just
// cleared as `DEPTH 1 CLEARED`, `DEPTH 2 CLEARED` and so on", and times it: "The
// cleared interstitial holds for at least `1 s` and at most `3 s` before the
// descent ... timed on the simulation's own accumulated time."
//
// THE MAZE IS CLEARED THE WAY A PLAYER CLEARS ONE. `clearPlankton` takes every
// plankton off the board and `specs/instrumentation.md` is explicit that doing so
// "scores nothing and clears no maze: ... an empty maze the forager has not just
// eaten from stays in live play". So one plankton is put back, on the corridor
// tile ahead of the forager, and the forager SWIMS INTO IT under a held key. The
// clear is then the build's own eat-and-clear path, on a board with exactly one
// mouthful left.
//
// WHY THE FORAGER IS MOVED ONTO IT RATHER THAN STOOD OVER IT. `specs/gameplay.md`
// has the forager eat "the plankton on its own tile, the moment its center enters
// that tile", so a build entitled to decide eating on tile ENTRY alone would never
// eat a pellet posed under a forager already standing there. `setForagerTile`
// "moves the forager to the center of tile (tx, ty)", so the pellet is planted on
// a tile the forager is NOT on and its center is then moved into that tile, which
// is the eat both readings agree on — and it owes the movement points nothing.
//
// THE FIXTURE IS POSED. A corridor that runs the way a key pushes is a property
// of the board a build invented, so `poseMoveKeyRun` lays down the same straight
// run under every build. A posed board carries no plankton at all, so this point
// plants the single pellet whose eating is the board running out — which is its
// whole subject.
//
// WHAT THIS DOES NOT DECIDE. The `SCORE_CLEAR` bonus, which is
// `scoring/cleared-bonus`'s; the descent to depth `d + 1`, which is
// `scoring/descend-on-clear`'s. All that is read past the interstitial here is
// that it gives way inside its own window.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { TICK_HZ } from "../constants";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { assertDrew, frameOps, watchScreen } from "./screens";

/**
 * The window `specs/ui.md` gives the cleared interstitial, in seconds: "The
 * cleared interstitial holds for at least `1 s` and at most `3 s` before the
 * descent."
 */
const HOLD_MIN = 1;
const HOLD_MAX = 3;

/**
 * The frames the maze is given to clear once the forager stands on its last
 * plankton.
 *
 * specs/gameplay.md has it eaten "the moment its center enters that tile", so a
 * conforming build clears on the next tick. One second is a hard ceiling well
 * past that, so a build that is merely slow fails here rather than leaving the
 * point inconclusive.
 */
const SWIM_TICKS = ticksFor(1);

/**
 * The ceiling on the interstitial watch, in frames.
 *
 * `specs/ui.md` gives it at most `3 s`, so a tick past that is a failure rather
 * than an inconclusive run.
 */
const MAX_HOLD_TICKS = ticksFor(HOLD_MAX) + 2;

/**
 * The uncertainty in the measured hold, in seconds.
 *
 * The interstitial begins DURING the frame this watch first sees it on and gives
 * way DURING the frame after the last one sampled, so the span read below is the
 * true hold to within two ticks either way — `1/60 s` against a two-second-wide
 * window.
 */
const TICK_SLACK = 2 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the cleared interstitial, names the depth, and holds 1-3 s", async () => {
  startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");

  // One mouthful left in the whole maze, one tile ahead of the forager — and
  // the forager CARRIED onto it rather than driven onto it. specs/gameplay.md
  // has it eat "the plankton on its own tile, the moment its center enters that
  // tile", and setForagerTile moves it to that center, so the eat this point
  // turns on owes the movement points nothing.
  const last = { tx: run.start.tx + 1, ty: run.start.ty };
  h.debug.clearPlankton();
  h.debug.setPlankton(last.tx, last.ty, true);
  h.debug.setForagerTile(last.tx, last.ty);

  const swim = await watchScreen(h, "playing", SWIM_TICKS);
  const cleared = swim.after;

  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "cleared");

  const hold = await watchScreen(h, "cleared", MAX_HOLD_TICKS);

  assertEqual(
    swim.hit,
    true,
    "the maze cleared inside the window the check gives it, the forager having " +
      "been stood on its last plankton",
  );
  assertEqual(
    cleared.planktonRemaining,
    0,
    "plankton left in the maze after the forager ate the last one " +
      "(specs/progression.md)",
  );
  assertEqual(
    cleared.screen,
    "cleared",
    "the screen eating the maze's last plankton reaches (specs/ui.md)",
  );
  assertDrew(
    ops,
    `DEPTH ${String(cleared.depth)} CLEARED`,
    "the depth just cleared, named on the interstitial (specs/ui.md)",
  );

  assertEqual(
    hold.hit,
    true,
    `the cleared interstitial gives way inside ${String(HOLD_MAX)} s of ` +
      "simulated time (specs/ui.md)",
  );
  // The ticks really ran, so the span below is a measurement rather than nothing.
  assertGreaterThan(
    hold.after.simTime - cleared.simTime,
    0,
    "simulated seconds accumulated while the interstitial held (specs/state.md)",
  );
  assertBetween(
    hold.after.simTime - cleared.simTime,
    HOLD_MIN - TICK_SLACK,
    HOLD_MAX + TICK_SLACK,
    "seconds of the simulation's own accumulated time the cleared " +
      "interstitial held for (specs/ui.md)",
  );
});

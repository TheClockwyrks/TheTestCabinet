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
// WHY IT IS SWUM INTO RATHER THAN STOOD ON. `specs/gameplay.md` has the forager
// eat "the plankton on its own tile, the moment its center enters that tile", so
// a build entitled to decide eating on tile ENTRY alone would never eat a pellet
// posed under a forager already standing there. Swimming in is the eat both
// readings agree on.
//
// THE FIXTURE IS POSED. A corridor that runs the way a key pushes is a property
// of the board a build invented, so `poseMoveKeyRun` lays down the same straight
// run under every build. Its sealed larder — the unreachable corridor every
// fixture carries so no scenario can clear the maze by accident — is emptied here
// along with everything else, deliberately: this is the one point whose whole
// subject is the board running out.
//
// WHAT THIS DOES NOT DECIDE. The `SCORE_CLEAR` bonus, which is
// `scoring/cleared-bonus`'s; the descent to depth `d + 1`, which is
// `scoring/descend-on-clear`'s. All that is read past the interstitial here is
// that it gives way inside its own window.

import { afterEach, beforeEach } from "vitest";
import { TICK_HZ } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { check, denAll, requireSwim } from "../scene";
import { MOVE_KEY, assertDrew, frameOps, watchScreen } from "./screens";

/**
 * The window `specs/ui.md` gives the cleared interstitial, in seconds: "The
 * cleared interstitial holds for at least `1 s` and at most `3 s` before the
 * descent."
 */
const HOLD_MIN = 1;
const HOLD_MAX = 3;

/**
 * The frames the forager is given to swim one tile into the last plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s`, and its center enters the next
 * tile half a tile in. One second is a hard ceiling four times that, so a build
 * that is merely slow fails here rather than leaving the point inconclusive.
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

check(
  "reaches the cleared interstitial, names the depth, and holds 1-3 s",
  async () => {
    startPlaying(h);
    const run = await poseMoveKeyRun(h, "right");
    await denAll(h);

    // One mouthful left in the whole maze, one tile ahead of the forager.
    h.debug.clearPlankton();
    h.debug.setPlankton(run.start.tx + 1, run.start.ty, true);
    const before = h.snapshot();

    const swim = await watchScreen(h, "playing", SWIM_TICKS, MOVE_KEY);
    // Whether the forager travels at all is the movement points' verdict.
    requireSwim(
      before.forager,
      swim.after.forager,
      "reach the maze's last plankton",
    );
    const cleared = swim.after;

    const ops = await frameOps(h);
    // Before the assertions, so a failing check still leaves the screen it read.
    captureStill(h, "cleared");

    const hold = await watchScreen(h, "cleared", MAX_HOLD_TICKS);

    assertEqual(
      swim.hit,
      true,
      "the forager reaches the maze's last plankton inside the window the check " +
        "gives it",
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
  },
);

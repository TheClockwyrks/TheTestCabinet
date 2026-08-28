// audio/descend — the descend cue.
//
// `specs/progression.md` fixes `CUES.descend` (`"descend"`) as the cue played
// when "a maze is cleared", and governs all seven with one sentence: "Each is
// played on the tick its event happens, and at most once on that tick." It also
// fixes the event itself: "A maze is cleared when the forager eats a plankton and
// none remain in the maze after it."
//
// SO THE CLEAR IS EARNED, not posed. `clearPlankton` takes every plankton off the
// board and `specs/instrumentation.md` is explicit that doing so "scores nothing
// and clears no maze: ... an empty maze the forager has not just eaten from stays
// in live play". One plankton is put back on the corridor tile ahead of the
// forager, and the forager SWIMS INTO IT — `specs/gameplay.md` has it eat "the
// plankton on its own tile, the moment its center enters that tile", so swimming
// in is the eat every conforming reading agrees on.
//
// TWO CUES SHARE THAT TICK, and that is the specification's own arrangement: "a
// tick that raises more than one of them plays each of those once". The last
// mouthful is an eat AND a clear, so `CUES.eat` and `CUES.descend` both belong to
// it. What this check reads is that the tick SOUNDED and that the ticks before it
// did not — under this engine a sound carries no name, so telling the two apart
// is a reviewer's job by ear.
//
// NO SCENE GUARD HERE. A guard's whole job is to notice the dive leaving the
// screen it was on; leaving `"playing"` for `"cleared"` IS this point's event.
// Every hunter is in the den instead, so nothing else can disturb the watch.
//
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. The `SCORE_CLEAR` bonus, which is
// `scoring/cleared-bonus`'s; the interstitial, which is `states/cleared`'s; the
// descent, which is `scoring/descend-on-clear`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { denAll, graded, requireSwim } from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `right` action to first. */
const MOVE_KEY = BINDINGS.right[0];

/**
 * The frames the forager is given to swim one tile into the last plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and its center enters the next
 * tile half a tile in. One second is a hard ceiling eight times that, so a build
 * that is merely slow fails here rather than leaving the point inconclusive.
 */
const SWIM_TICKS = ticks(1);

/** Frames run past the reading, purely so the clip shows the maze clear. */
const TAIL_TICKS = ticks(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.descend on the tick the maze is cleared, and not before", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const run = await poseMoveKeyRun(h, "right");
    await denAll(h);

    // One mouthful left in the whole maze, one tile ahead of the forager. The
    // fixture's own sealed larder goes with everything else, deliberately: this
    // is a point whose subject is the board running out.
    h.debug.clearPlankton();
    h.debug.setPlankton(run.tx + 1, run.ty, true);
    const before = h.snapshot();

    const seen = await captureReplay(h, "descend", async () => {
      h.hold(MOVE_KEY);
      try {
        const found = await watchForEvent(
          h,
          (s) => s.screen === "cleared",
          SWIM_TICKS,
        );
        // Past the reading, so the clip shows the interstitial. Nothing after
        // this line can reach an assertion.
        await h.advance(TAIL_TICKS);
        return found;
      } finally {
        h.release(MOVE_KEY);
      }
    });

    // Whether the forager travels at all is the movement points' verdict.
    requireSwim(
      before.forager,
      seen.snapshot.forager,
      "reach the maze's last plankton",
    );

    assertEqual(
      seen.hit,
      true,
      `the forager ate the maze's last plankton and cleared it inside ` +
        `${String(SWIM_TICKS)} ticks, from tile (${String(run.tx)}, ${String(run.ty)})`,
    );
    assertEqual(
      cuesBeforeEvent(seen, CUES.descend),
      0,
      `times CUES.descend played over the ${String(seen.at - 1)} ticks before ` +
        "the maze cleared — a cue is played on the tick its event happens " +
        "(specs/progression.md)",
    );
    assertEqual(
      cuesOnEvent(seen, CUES.descend),
      1,
      "times CUES.descend played on the tick the maze cleared, which is its own " +
        "tick and at most once on it (specs/progression.md)",
    );
  });
});

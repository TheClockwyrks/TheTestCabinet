// scoring/cleared-bonus — the bite that empties the maze pays 510 and clears it.
//
// `specs/gameplay.md`: "Eating the plankton that leaves none behind clears the
// maze." `specs/progression.md`: "Clearing awards the `SCORE_CLEAR` bonus and
// `screen` becomes `"cleared"`", over a scoring table that pays `SCORE_PLANKTON`
// (`10`) for the plankton itself and `SCORE_CLEAR` (`500`) for the clear, and a
// score that "rises by the exact figure above and by nothing else". So the bite is
// worth exactly `510`, and the two halves are read as one sum because they are one
// event.
//
// THE MAZE IS EMPTIED FIRST, DELIBERATELY. `clearPlankton`
// (`specs/instrumentation.md`) "takes every plankton off the maze at once", and
// "nothing here is eaten, so it scores nothing and clears no maze: the maze is
// cleared by the forager eating a plankton when none remain after it, and an empty
// maze the forager has not just eaten from stays in live play". One pellet is then
// posed back at the far end of the run, so the board holds exactly one plankton
// and the forager's bite is the one that leaves none behind. Nothing about the
// clear is fabricated: the empty board is the precondition and the eat is the
// game's own.
//
// NO SCENE GUARD. The guard exists to report a scenario that stopped standing, and
// the first thing it names is a screen that changed under the measurement — which
// here is the subject. What the guard would otherwise have caught, a hunter
// reaching the forager, is asserted directly instead: every predator is posed into
// the sealed den, and the lives are read either side of the bite.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ARROW_KEY, SCORE_CLEAR, SCORE_PLANKTON } from "../constants";
import { placeForager, poseMaze } from "../fixtures";
import { captureReplay, createHarness, ticks, type Harness } from "../harness";
import { denAllExcept, requireSwim, startPlaying } from "../scene";

/**
 * The board: five tiles of straight corridor, the forager on the first and the
 * maze's last remaining pellet on the last, which is a dead end.
 */
const ART = ["S...T"] as const;

/**
 * How long the bite may take under a held key, in ticks.
 *
 * The pellet is four tiles (128 units) along the run, which `FORAGER_SPEED` (128
 * units per second, `specs/movement.md`) covers in one second. Two seconds is a
 * HARD ceiling, so a build merely too slow fails here rather than leaving the
 * point undecided.
 */
const BITE_BUDGET = ticks(2);

/**
 * Ticks between the bite and the reading, so a build that raises the screen at the
 * top of the step after the eat is read as conforming.
 *
 * A tenth of a second, far inside the `1 s` the cleared interstitial holds for at
 * the very least (`specs/ui.md`), so the reading is taken on the cleared screen
 * rather than after the descent it gives way to. Nothing else can score in the
 * window: the maze holds no plankton and no drifter.
 */
const SETTLE_TICKS = ticks(0.1);

/** Ticks held past the reading, purely so the clip shows the maze clearing. */
const TAIL_TICKS = ticks(0.75);

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("pays SCORE_CLEAR on top of the plankton for the bite that empties the maze", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const start = board.mark("S");
  const target = board.mark("T");
  await placeForager(h, start, "right");
  // One plankton on the whole board, at the far end of the forager's run.
  await h.debug.clearPlankton();
  await h.debug.setPlankton(target.tx, target.ty, true);
  await denAllExcept(h);

  const bite = await captureReplay(h, "clear", async () => {
    const before = await h.snapshot();
    await h.hold(ARROW_KEY.right);
    const eaten = await h.until((s) => s.planktonRemaining < 1, {
      maxTicks: BITE_BUDGET,
      poll: 1,
    });
    await h.advance(SETTLE_TICKS);
    const settled = await h.snapshot();
    await h.advance(TAIL_TICKS);
    await h.release(ARROW_KEY.right);
    return { before, after: eaten.snapshot, settled, hit: eaten.hit };
  });

  if (!bite.hit) {
    requireSwim(
      h,
      bite.before.forager,
      bite.after.forager,
      "reach the maze's last plankton",
    );
  }

  assertEqual(
    bite.before.planktonRemaining,
    1,
    "the plankton on the board when the bite began, which the pose left at one",
  );
  assertEqual(
    bite.settled.lives,
    bite.before.lives,
    "the lives across the bite, with every predator posed into the sealed den",
  );
  assertEqual(
    bite.settled.score - bite.before.score,
    SCORE_CLEAR + SCORE_PLANKTON,
    "the score rise across the bite that left no plankton behind",
  );
  assertEqual(
    bite.settled.screen,
    "cleared",
    "the screen a beat after the maze's last plankton was eaten",
  );
});

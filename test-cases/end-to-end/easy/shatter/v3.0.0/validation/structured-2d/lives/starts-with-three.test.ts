// lives/starts-with-three — a game opened from the title has three ships.
//
// THE RULE. `specs/progression.md`: "A new game begins with `START_LIVES` (`3`)
// ships, counting the one being flown". `specs/instrumentation.md` says the same
// thing about the counter that reports it: "`lives` counts every ship left
// including the one being flown, so a fresh game reports `3`". This item decides
// that opening figure and nothing else — what a ship COSTS is the rest of this
// group, and how many glyphs the HUD draws for it is
// `presentation/hud-lives-are-drawn`.
//
// THE GAME IS OPENED THE WAY A PLAYER OPENS ONE, through `PLAY` on the title
// menu (`specs/ui.md`), because that is what "a new game" means here: no pose on
// the surface starts a run, and the figure this item is about is the one the
// opening path sets. The two steps are taken by hand rather than through the
// harness's `startRun`, which resets a second time and would wash the poisoned
// counter below away.
//
// THE COUNTER IS POISONED FIRST, and that is the whole strength of the check.
// `reset()` restores `lives` to `START_LIVES` itself
// (`specs/instrumentation.md`), so a game opened straight off a reset reports
// three whether or not opening it set anything — the reading would pass on a
// build whose `PLAY` carries the previous run's ship count forward, which is
// exactly the fault worth catching. `setLives(1)` at the title leaves one ship
// standing where three belong, so the three this check reads is one the OPENING
// had to put there.
//
// THE SCREEN IS READ FIRST, as the precondition rather than as the point: a
// `lives` of three on a game that never opened would be the title's own value.
// The transition itself is `screens/play-starts-a-game`.
//
// The world gates are left exactly as `reset` restores them — both ON — so this
// is a real opening with a real wave 1 behind it, which is what the still shows.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The ship count posed at the title, so the opening's own figure is what is read. */
const POISONED_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with START_LIVES ships", async () => {
  resetTo(h);
  h.debug.setLives(POISONED_LIVES);
  assertEqual(
    h.snapshot().lives,
    POISONED_LIVES,
    "setLives to be reported by the snapshot before the game is opened " +
      "(specs/instrumentation.md)",
  );

  // `confirm` on the title's highlighted first entry, `PLAY`, which is what
  // opens a new game (specs/ui.md). One frame runs: the one the press lands in.
  await tapAction(h, "confirm");
  const opened = h.snapshot();
  captureStill(h, "opening");

  assertEqual(
    opened.screen,
    "playing",
    "confirming PLAY on the title menu to open a game (specs/ui.md)",
  );
  assertEqual(
    opened.lives,
    START_LIVES,
    "the ships a new game begins with, counting the one being flown " +
      "(specs/progression.md)",
  );
});

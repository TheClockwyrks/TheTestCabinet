// progression/starts-with-lives — a run opens on START_LIVES lives.
//
// specs/progression.md opens with the figure: "A run starts with `START_LIVES`
// (`3`) lives." specs/ui.md prices the title's mode entry the same way — it
// "Opens a new run and moves to `stageIntro` at stage `1`, with `START_LIVES`
// lives and a score of `0`."
//
// THE RUN IS OPENED, NOT POSED. `setLives` cannot answer this question and
// neither can `reset`: specs/instrumentation.md has `reset` restore `lives` to
// `START_LIVES` itself, so a check that reset and read the count straight back
// would report three on a build whose run-opening never touches the lives at all.
//
// SO THE DISTINGUISHING VALUE IS POSED FIRST. After the reset the count is posed
// DOWN to one — a run near its end — and only then is the mode entry confirmed,
// with a real `Enter` through the engine's own input path. Now the three wrong
// models each read a different number: a build that sets the lives when it opens
// a run reads three, a build that carries the previous run's count forward reads
// one, and a build whose confirm does nothing at all reads one and is still
// sitting on the title.
//
// THE WORLD IS THE ONE `reset` LEAVES. `startPosed` is not used here, because it
// poses live play and this point is about what opening a run from the title does;
// `reset` empties the three rosters, restores the title screen and puts the menu
// highlight back on the first item (specs/instrumentation.md), which is the state
// a player reaches the title in.
//
// WHAT THIS DOES NOT DECIDE. What the title menu draws, or where `confirm` goes
// from each of its items, which are `screens/`'s. The screen is read here only to
// say that a run was opened at all, since a count read on the title screen would
// not be a run's opening figure.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_INTRO_HOLD, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The key `confirm` is bound to, from specs/controls.md's bindings table
 * (`Enter`, `Space`). `Enter` is the one that drives `confirm` alone: `Space`
 * also drives `a`, and this point has no business with the cannon.
 */
const CONFIRM_KEY = "Enter";

/**
 * The lives posed on the title before the run is opened.
 *
 * Anything but `START_LIVES` (`3`) would do; one is chosen because it is what a
 * run about to end holds, so a build that carries the count forward reads a
 * number a player would recognise as wrong.
 */
const POSED_LIVES = 1;

/**
 * The menu item `confirm` is taken on: the first, which specs/ui.md fixes as the
 * mode entry that opens a new run.
 */
const MODE_ENTRY = 0;

/**
 * Frames run after the confirm, in frames of the 120 Hz clock.
 *
 * `Harness.tap` already runs the one frame that delivers the press edge, so this
 * is the frame after it: room for a build that acts on a press it latched during
 * the previous frame. The stage intro it opens onto lasts `STAGE_INTRO_HOLD`
 * (`2.0` s, specs/ui.md), 240 frames of this clock, so the reading is taken well
 * inside the hold the run opens on.
 */
const OPEN_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run from the title on START_LIVES lives", async () => {
  h.debug.reset();
  // The pose that makes the reading mean something: the count is NOT already
  // sitting on the figure the run is required to open with.
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(MODE_ENTRY);

  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen a reset leaves the game on");
  assertEqual(title.lives, POSED_LIVES, "the lives posed before the confirm");

  // A real key, through the engine's own input, on the highlighted first item.
  await h.tap(CONFIRM_KEY);
  await h.advance(OPEN_TICKS);
  const opened = h.snapshot();
  captureStill(h, "lives");

  assertEqual(
    opened.screen,
    "stageIntro",
    `the screen ${OPEN_TICKS + 1} frames after ${CONFIRM_KEY} took the title's ` +
      "first menu item — specs/ui.md: the mode entry opens a new run and moves " +
      `to stageIntro, whose hold is STAGE_INTRO_HOLD ${STAGE_INTRO_HOLD} s ` +
      `(${ticksFor(STAGE_INTRO_HOLD)} frames), so the reading sits well inside ` +
      "it. Without a run being opened there is no opening life count to read",
  );
  assertEqual(
    opened.lives,
    START_LIVES,
    `the lives the new run opened with ${seconds(OPEN_TICKS + 1)} s after the ` +
      `confirm, from a title posed at ${POSED_LIVES} — specs/progression.md: a ` +
      `run starts with START_LIVES ${START_LIVES}. ${POSED_LIVES} is a build ` +
      "that carried the previous run's count into the new one",
  );
});

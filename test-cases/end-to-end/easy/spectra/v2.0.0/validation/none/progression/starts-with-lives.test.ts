// progression/starts-with-lives — a run opens on START_LIVES lives.
//
// `specs/progression.md` opens with the figure: "A run starts with `START_LIVES`
// (`3`) lives." `specs/ui.md` prices the title's mode entry the same way — it
// "Opens a new run and moves to `stageIntro` at stage `1`, with `START_LIVES`
// lives and a score of `0`."
//
// THE RUN IS OPENED, NOT POSED. `setLives` cannot answer this question and
// neither can `reset`: `specs/instrumentation.md` has `reset` restore `lives` to
// `START_LIVES` itself, so a check that reset and read the count straight back
// would report three on a build whose run-opening never touches the lives at all.
//
// SO THE DISTINGUISHING VALUE IS POSED FIRST. After the reset the count is posed
// DOWN to one — a run near its end — and only then is the mode entry confirmed,
// with a real `Enter` through Chromium's own input pipeline. Now the three wrong
// models each read a different number: a build that sets the lives when it opens
// a run reads three, a build that carries the previous run's count forward reads
// one, and a build whose confirm does nothing at all reads one and is still
// sitting on the title.
//
// WHAT THIS DOES NOT DECIDE. What the title menu draws, or where `confirm` goes
// from each of its items, which are `screens/`'s. The screen is read here only to
// say that a run was opened at all, since a count read on the title screen would
// not be a run's opening figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * The lives posed on the title before the run is opened.
 *
 * Anything but `START_LIVES` (`3`) would do; one is chosen because it is what a
 * run about to end holds, so a build that carries the count forward reads a
 * number a player would recognise as wrong.
 */
const POSED_LIVES = 1;

/**
 * Frames run after the confirm.
 *
 * `Harness.tap` already runs the one frame that delivers the press, so this is
 * the frame after it: room for a build that acts on a press it latched during the
 * previous frame. The stage intro it opens onto lasts `STAGE_INTRO_HOLD` (`2.0`
 * seconds, `specs/ui.md`), two hundred frames of this harness's 100 Hz clock, so
 * the reading is taken well inside the hold the run opens on.
 */
const OPEN_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a run from the title on START_LIVES lives", async () => {
  await h.debug.reset();
  // The pose that makes the reading mean something: the count is NOT already
  // sitting on the figure the run is required to open with.
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setMenuIndex(0);
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen a reset leaves the game on");
  assertEqual(title.lives, POSED_LIVES, "the lives posed before the confirm");

  // A real key, through the browser, on the highlighted first item — the mode
  // entry `specs/ui.md` puts at the top of the title menu.
  await h.tap("Enter");
  await h.advance(OPEN_FRAMES);
  const opened = await h.snapshot();
  await captureStill(h, "lives");

  assertEqual(
    opened.screen,
    "stageIntro",
    "the screen confirming the title's mode entry opens (specs/ui.md) — " +
      "without a run being opened there is no opening life count to read",
  );
  assertEqual(
    opened.lives,
    START_LIVES,
    `the lives the new run opened with, from a title posed at ${String(POSED_LIVES)} — ` +
      "a run starts with START_LIVES (3) (specs/progression.md)",
  );
});

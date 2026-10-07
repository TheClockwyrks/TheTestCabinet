// progression/starts-level-one — a new run opens at level 1.
//
// THE RULE. `specs/progression.md`, *Starting a run*: a new run opens with Level
// `1` and the level reached `1`. Both are one rule — the run begins at the top of
// the twelve — and `specs/ui.md` states that `DESCEND` is what opens it.
//
// HOW THE POSE MAKES THE READING MEAN SOMETHING. A fresh build already reports
// level 1, so the title is posed part-way down a run first: opening from there
// has to put BOTH figures back to `1`. A build that carries the run over reads the
// posed level, and a build that resets the level while leaving the level reached
// alone reads one of the two wrong — which is why both are read here rather than
// only the first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The level a new run opens at (specs/progression.md). */
const FIRST_LEVEL = 1;

/**
 * The level the title is posed carrying: well inside `setLevel`'s `1..12` domain
 * and nowhere near `1`, so nothing a build could do to a stale figure lands on the
 * answer by accident.
 */
const STALE_LEVEL = 7;

/** The first entry of `TITLE_ITEMS`, which is `DESCEND` (specs/ui.md). */
const DESCEND = 0;

/** A key bound to `confirm` in `BINDINGS` (specs/controls.md). */
const CONFIRM_KEY = "Enter";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens a run at level 1, with the level reached at 1", async () => {
  const { debug } = harness;
  debug.setScreen("title");
  debug.setMenuIndex(DESCEND);
  debug.setLevel(STALE_LEVEL);
  debug.setReachedLevel(STALE_LEVEL);

  await harness.tap(CONFIRM_KEY);

  captureStill(harness, "opening");
  const opened = harness.snapshot();
  assertEqual(opened.level, FIRST_LEVEL, "level");
  assertEqual(opened.reachedLevel, FIRST_LEVEL, "reachedLevel");
});

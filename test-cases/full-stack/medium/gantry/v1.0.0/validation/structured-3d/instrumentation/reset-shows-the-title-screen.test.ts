// instrumentation/reset-shows-the-title-screen — a reset returns the game to its
// title state, so whatever screen was showing, the title screen shows after it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: the `title`
// screen with `menuIndex` `0`, site `0` open, …". The screen is the first field
// that sentence names, and this check decides that field and no other.
//
// THE SCREEN IS POSED, NOT PLAYED TO. The precondition the requirement carries is
// exactly "a screen other than `title` is showing", and `setScreen` "shows a named
// screen and sets nothing else" (`specs/instrumentation.md`), so one call
// establishes it. The screen posed is `run`: one of the seven identifiers
// `specs/ui.md` fixes, the furthest from the title, and the one screen no arrival
// and no reset ever leaves showing — so the reading afterwards is the reset's own
// work and cannot be a screen that was already there.
//
// THE RESET IS STILL EARNED. Nothing here poses the outcome: `reset` is called on
// the real game and the screen is read back off the build's own snapshot on the
// frame that follows.
//
// WHAT THIS POINT DELIBERATELY NO LONGER DRIVES. Reaching the run screen by
// emptying the world, standing a crane, posing a tape and starting a run puts the
// editor, the structure solve and the `run` action between this item and the field
// it decides: a build with a sound `reset` and a broken crane would have failed
// here for a defect belonging to another item. The run a reset has to undo is a
// requirement of its own, and `instrumentation/reset-returns-the-run-to-idle`
// starts a real one to decide it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The screen the reset is taken from: no arrival and no reset leaves it showing. */
const POSED = "run";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the title screen after a reset taken from another screen", async () => {
  await h.debug.setScreen(POSED);

  assertEqual(
    (await h.snapshot()).screen,
    POSED,
    "the screen the reset is taken from, which `setScreen` shows and sets " +
      "nothing else for (specs/instrumentation.md)",
  );

  await h.debug.reset();
  const screen = (await h.snapshot()).screen;
  await h.advance(1);
  await h.capture("title", "The screen a reset leaves showing");

  assertEqual(
    screen,
    "title",
    "the screen a reset leaves (specs/instrumentation.md)",
  );
});

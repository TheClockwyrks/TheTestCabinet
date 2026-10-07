// controls/program-key — `KeyP` takes the build screen to the program screen.
//
// `specs/controls.md` § The actions: the `program` action is bound to `KeyP` and
// does "build screen to program screen". `specs/ui.md` § Build says the same of
// the screen: "`program` switches to the tape, `run` starts the run, and `back`
// returns to `select`."
//
// The build screen is reached by opening a site, which is what "entering a site
// from the select screen does" (`specs/instrumentation.md`) and leaves the build
// screen showing — rather than by pressing a menu entry on the way, because a
// build with a broken menu must fail the menu items and be decided fairly on this
// one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `program` action's binding, as `specs/controls.md` fixes it. */
const PROGRAM_KEY = BINDINGS.program[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the program screen from the build screen", async () => {
  await openSite(h, 0);
  assertEqual(
    (await h.snapshot()).screen,
    "build",
    "the screen the `program` action is pressed on",
  );

  await h.press(PROGRAM_KEY);
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the program screen the program action opened");

  assertEqual(
    after.screen,
    "program",
    `the screen after ${PROGRAM_KEY}, which is the program action's binding ` +
      "(specs/controls.md)",
  );
});
